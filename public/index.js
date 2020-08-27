let transactions = [];
let myChart;

function populateTotal() {
  // reduce transaction amounts to a single total value
  let total = transactions.reduce((total, t) => {
    return total + parseInt(t.value);
  }, 0);

  let totalEl = document.querySelector("#total");
  totalEl.textContent = total;
}

function populateTable() {
  let tbody = document.querySelector("#tbody");
  tbody.innerHTML = "";

  transactions.forEach(transaction => {
    // create and populate a table row
    let tr = document.createElement("tr");
    if (transaction.offline) tr.classList.add('offline')

    tr.innerHTML = `
      <td>${transaction.name}</td>
      <td>${transaction.value}</td>
    `;

    tbody.appendChild(tr);
  });
}

function populateChart() {
  // copy array and reverse it
  let reversed = transactions.slice().reverse();
  let sum = 0;

  // create date labels for chart
  let labels = reversed.map(t => {
    let date = new Date(t.date);
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  });

  // create incremental values for chart
  let data = reversed.map(t => {
    sum += parseInt(t.value);
    return sum;
  });

  // remove old chart if it exists
  if (myChart) {
    myChart.destroy();
  }

  let ctx = document.getElementById("myChart").getContext("2d")
  myChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: "Total Over Time",
        fill: true,
        backgroundColor: "#6666ff",
        data
      }]
    }
  });
}

function sendTransaction(isAdding) {
  let nameEl = document.querySelector("#t-name");
  let amountEl = document.querySelector("#t-amount");
  let errorEl = document.querySelector(".form .error");

  // validate form
  if (nameEl.value === "" || amountEl.value === "") {
    errorEl.textContent = "Missing Information";
    return;
  }
  else {
    errorEl.textContent = "";
  }

  // create record
  let transaction = {
    name: nameEl.value,
    value: amountEl.value,
    date: new Date().toISOString()
  };

  // if subtracting funds, convert amount to negative number
  if (!isAdding) {
    transaction.value *= -1;
  }

  // add to beginning of current array of data
  transactions.unshift(transaction);

  // re-run logic to populate ui with new record
  populateChart();
  populateTable();
  populateTotal();

  // also send to server
  fetch("/api/transaction", {
    method: "POST",
    body: JSON.stringify(transaction),
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json"
    }
  })
    .then(response => {
      return response.json();
    })
    .then(data => {
      if (data.errors) {
        errorEl.textContent = "Missing Information";
      }
      else {
        fetch("/api/transaction")
        Sync.start();

        // clear form
        nameEl.value = "";
        amountEl.value = "";
      }
    })
    .catch(async err => {
      // fetch failed, so save in indexed db
      transactions.shift()
      const offlineTransaction = { ...transaction, offline: true };
      transactions.unshift(offlineTransaction)
      populateTable()

      await ORM.saveTransaction(offlineTransaction)
      displayMessage("transaction stayed localy")
      Sync.start()

      // clear form
      nameEl.value = "";
      amountEl.value = "";
    });
}

document.querySelector("#add-btn").onclick = function () {
  sendTransaction(true);
};

document.querySelector("#sub-btn").onclick = function () {
  sendTransaction(false);
};

const fetchTimeout = (url, options, timeout = 2000) => {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeout)
    )
  ]);
}

const ORM = (() => {
  const rawRequest = (method, data) => new Promise((resolve, reject) => {
    const request = indexedDB.open("transactions", 1)

    request.onblocked = (event) => console.error('blocked', event)
    request.onupgradeneeded = (event) => {
      event.target.result.createObjectStore('Transaction', { keyPath: 'date' });
    }

    request.onerror = reject;
    request.onsuccess = (event) => {
      const database = event.target.result
      const transaction = database.transaction("Transaction", "readwrite");
      const store = transaction.objectStore("Transaction")

      let action;
      if (method === 'create') action = store.put(data)
      else if (method === 'read') action = store.getAll()
      else if (method === 'delete') action = store.clear()
      else if (method === 'count') action = store.count()
      else return reject("unsupportedMethod: " + method);

      action.onerror = reject
      action.onsuccess = resolve

      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
    }
  })

  const parseResult = (event) => event.target.result

  const saveTransaction = (transaction) => rawRequest('create', transaction);
  const getAll = () => rawRequest('read').then(parseResult)
  const deleteAll = () => rawRequest('delete')
  const getCount = () => rawRequest('count').then(parseResult)

  return { saveTransaction, getCount, getAll, deleteAll };
})();

const Sync = (() => {
  let syncTimeOut = null
  const SYNC_INTERVAL = 5000

  const stop = () => {
    if (syncTimeOut) clearTimeout(syncTimeOut)
    syncTimeOut = null
  }

  const start = async () => {
    stop()

    if (!(await ORM.getCount())) return;
    const offlineTransactions = await ORM.getAll();

    fetch("/api/health")
      .then(() => sendBulk(offlineTransactions))
      .catch(() => {
        displayMessage("retrying in a min");
        setTimeout(start, SYNC_INTERVAL);
      })
  }

  return { start, stop };
})();


const displayMessage = (text) => {
  console.log(text)
  document.querySelector(".form .error").textContent = text;
}
const handleOffline = async () => {
  Sync.stop()

  const count = await ORM.getCount();
  displayMessage(count
    ? `${count} transactions not saved to server wait for network connection`
    : ""
  )
}

const sendBulk = (offlineTransactions) => {
  return fetch("/api/transaction/bulk", {
    method: "POST",
    body: JSON.stringify(offlineTransactions.map((transaction) => {
      const { offline, ...expected } = transaction;
      return expected;
    })),
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json"
    }
  }).then(async (response) => {
    if (!response.ok) return console.error(response);

    await ORM.deleteAll()

    transactions.filter((t) => t.offline).forEach((t) => {
      delete t.offline
    });
    populateTable();

    displayMessage(`${offlineTransactions.length}transactionSubitted`);
  });
}

(() => {
  fetch("/api/transaction")
    .then(response => {
      return response.json();
    })
    .then(async data => {
      // save db data on global variable
      transactions = data;

      populateTotal();
      populateTable();
      populateChart();

      if (!(await ORM.getCount())) return
      const offlineTransactions = await ORM.getAll();

      transactions = [...offlineTransactions, ...data]

      populateTotal();
      populateTable();
      populateChart();

      Sync.start()
    });


  window.addEventListener('offline', handleOffline);
  if (!navigator.onLine) handleOffline();

  window.addEventListener('online', async () => {
    if (!(await ORM.getCount())) return displayMessage("")

    Sync.start();
  });
})();