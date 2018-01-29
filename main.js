const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  session,
  ipcMain,
  dialog,
} = require('electron');
const fetch = require('node-fetch');
const path = require('path');
const url = require('url');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store');
const store = new Store();

if (process.env.NODE_ENV === 'development') {
  console.info('Electron is reloading');
  require('electron-reload')(__dirname, {
    electron: require(`${__dirname}/node_modules/electron`)
  });
}

autoUpdater.checkForUpdatesAndNotify();

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.

let RobinHoodAPI = null;
let tray = null;
let win = null;
// Set this to the value of setTimeout()
let refresh;

ipcMain.on('data', (event, arg) => {
  RobinHoodAPI = arg;
  store.set('data', RobinHoodAPI);
  const contextMenu = createTickerMenu();
  tray.setContextMenu(contextMenu);
  tray.popUpContextMenu(contextMenu);
  refresh = startRefresh();
});

const startRefresh = () => {
  const refreshRate = store.get('refreshRate') * 60 * 1000;
  console.log(`Refreshing at rate: ${refreshRate}`);
  return setInterval(async () => {
    try {
      await refreshAccountData(RobinHoodAPI._accountNumber);
      console.log('Refresh success!')
      const contextMenu = createTickerMenu();
      tray.setContextMenu(contextMenu);
      const equity = Number(RobinHoodAPI._portfolio.equity).toFixed(2);
      tray.setTitle(`$${equity}`);
    } catch (e) {
      console.log('Could not refresh');
      console.log(e);
      clearInterval(refresh);
    }
  }, refreshRate);
};

const changeRefreshRate = (rate) => {
  console.log(`Changing refresh rate to: ${rate}`);
  store.set('refreshRate', rate);
  clearInterval(refresh);
  refresh = startRefresh();
};


const refreshAccountData = async (accountNumber) => {
  const fetchWithAuth = (url) => {
    return fetch(url, {
      headers: { Authorization: `Token ${RobinHoodAPI._token}` },
    });
  };

  try {
    let res = await fetchWithAuth(`https://api.robinhood.com/accounts/${accountNumber}/positions/`);
    let json = await res.json();
    if (res.ok) {
      const transformed = await Promise.all(json.results
        .filter((result) => Number(result.quantity) !== 0)
        .map(async (result) => {
          const instrument = await(await fetchWithAuth(decodeURIComponent(result.instrument))).json();
          const quote = await(await fetchWithAuth(decodeURIComponent(instrument.quote))).json();
          return {
            averageBuyPrice: result.average_buy_price,
            instrument: result.instrument,
            quantity: Number(result.quantity),
            quote: quote,
            currentPrice: quote.last_traded_price,
            symbol: instrument.symbol,
            name: instrument.name,
            instrument: instrument,
          }
        }));
      RobinHoodAPI._positions = transformed;
    } else {
      console.log(json);
      throw new Error('Could not retrieve positions');
    }

    res = await fetchWithAuth(`https://api.robinhood.com/accounts/${accountNumber}/portfolio/`);
    json = await res.json();
    if (res.ok) {
      RobinHoodAPI._portfolio = json;
    } else {
      console.log(json);
      throw new Error('Could not retrieve portfolio');
    }
  } catch (e) {
    throw e;
  }
}

const createBrowserWindow = () => {
  return new BrowserWindow({
    width: 300,
    height: 450,
    backgroundColor: '#61CA9D',
    center: true,
    title: 'RobinHood Ticker',
    resizable: false,
    show: false,
  });
};

const createLoginMenu = () => {
  const template = [
    {
      label: 'Login',
      click: () => {
        if (win === null) {
          win = createBrowserWindow();
        }
        win.loadURL(url.format({
          pathname: path.join(__dirname, 'index.html'),
          protocol: 'file:',
          slashes: true,
        }));
        win.on('close', () => {
          win = null;
        });
        win.webContents.on('did-finish-load', () => win.show());
      },
    },
  ];
  template.push(
    {
      type: 'separator',
    },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  );
  return Menu.buildFromTemplate(template);
};

const createTickerMenu = () => {
  const { _portfolio: portfolio, _positions: positions } = RobinHoodAPI;
  const template = positions.map((data) => {
    const price = (data.quantity * Number(data.quote.last_trade_price));
    const difference = (price - data.quantity * data.quote.previous_close);
    const sign = difference >= 0 ? '+' : '-';
    return {
      label: `${data.symbol} | $${price.toFixed(2)} | ${sign}${Math.abs(difference).toFixed(2)}`,
      click: () => {},
    };
  });
  const dailyEquityDifference = Number(portfolio.equity) - Number(portfolio.equity_previous_close);
  const sign = dailyEquityDifference >= 0 ? '+' : '-';
  template.unshift(
    {
      label: `Today: ${sign}${Math.abs(dailyEquityDifference.toFixed(2))}`
    },
    {
      type: 'separator',
    },
  );
  template.push(
    {
      type: 'separator',
    },
    {
      label: 'Refresh Every...',
      submenu: [
        {
          label: '1 minute',
          type: 'radio',
          checked: store.get('refreshRate') === 1,
          click: () => changeRefreshRate(1),
        },
        {
          label: '2 minutes',
          type: 'radio',
          checked: store.get('refreshRate') === 2,
          click: () => changeRefreshRate(2),
        },
        {
          label: '5 minutes',
          type: 'radio',
          checked: store.get('refreshRate') === 5,
          click: () => changeRefreshRate(5),
        },
        {
          label: '15 minutes',
          type: 'radio',
          checked: store.get('refreshRate') === 15,
          click: () => changeRefreshRate(15),
        },
        {
          label: '30 minutes',
          type: 'radio',
          checked: store.get('refreshRate') === 30,
          click: () => changeRefreshRate(30),
        },
      ],
    },
    {
      label: 'Logout',
      click: () => {
        store.delete('data');
        const contextMenu = createLoginMenu();
        tray.setTitle('');
        tray.setContextMenu(contextMenu);
        tray.popUpContextMenu(contextMenu);
      },
    },
    {
      label: 'About',
      click: () => showAboutDialog(),
    },
    {
      label: 'Quit',
      role: 'quit',
    },
  );
  return Menu.buildFromTemplate(template);
}

const showAboutDialog = () => {
  dialog.showMessageBox({
    type: 'info',
    title: 'About',
    message: 'RobinHood Ticker \n\nYour information is NEVER stored or collected. \n\nFind me on www.github.com/peniqliotuv',
    icon: `${__dirname}/logo-large.png`,
  });
}

const isAuthenticated = () => store.get('data') ? true : false;

const initializeApp = () => {
  app.dock.hide();
  // Necessary to prevent CORS since Electron sends things with an origin of file://
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Origin'] = 'electron://robinhood-app';
    details.requestHeaders['content-type'] = 'application/json';
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  if (!store.get('refreshRate')) {
    store.set('refreshRate', 1);
  }

  // Create the browser window.
  win = createBrowserWindow();
  win.loadURL(url.format({
    pathname: path.join(__dirname, 'index.html'),
    protocol: 'file:',
    slashes: true,
  }));

  win.on('close', () => {
    win = null;
  });

  if (process.env.NODE_ENV === 'development') {
    win.openDevTools();
  }

  tray = new Tray(`${__dirname}/logo.png`);

  let contextMenu;
  if (isAuthenticated()) {
    RobinHoodAPI = store.get('data');
    contextMenu = createTickerMenu();
    const equity = Number(RobinHoodAPI._portfolio.equity).toFixed(2);
    tray.setTitle(`$${equity}`);
    global.addAuthHeaders(RobinHoodAPI._token);
    refresh = startRefresh();
  } else {
    contextMenu = createLoginMenu();
  }

  tray.setContextMenu(contextMenu);

  // Emitted when the window is closed.
  tray.on('closed', () => {
    tray = null;
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', initializeApp);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win === null) {
    initializeApp();
  }
});

// Necessary to authenticating requests
global.addAuthHeaders = (token) => {
  console.log('adding auth headers' + token);
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Origin'] = 'electron://robinhood-app';
    details.requestHeaders['content-type'] = 'application/json';
    details.requestHeaders['Authorization'] = `Token ${token}`
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });
}
