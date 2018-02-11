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
const openAboutWindow = require('about-window').default;

const stockAPI = require('./StockAPI');
const Store = require('electron-store');
const store = new Store();

const ICON_LOGO_LARGE = `${__dirname}/assets/logo-512.png`;
const ICON_LOGO = `${__dirname}/assets/logo-16.png`;

if (process.env.NODE_ENV === 'development') {
  console.info('Electron is reloading');
  require('electron-reload')(__dirname, {
    electron: require(`${__dirname}/node_modules/electron`)
  });
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.

let stockInfoWindow = null;
let preferences = null;
let RobinHoodAPI = null;
let tray = null;
let win = null;
// Set this to the value of setTimeout()
let refresh;

/* When we receieve the initial load from the login */
ipcMain.on('data', (event, arg) => {
  console.log('data received from IPC');
  RobinHoodAPI = arg;
  store.set('data', RobinHoodAPI);
  const contextMenu = createTickerMenu();
  const equity = Number(RobinHoodAPI._portfolio.extended_hours_equity || RobinHoodAPI._portfolio.equity).toFixed(2);
  tray.setTitle(`$${equity}`);
  tray.setContextMenu(contextMenu);
  refresh = startRefresh();
});

ipcMain.on('preferences-saved', (event, arg) => {
  console.log('Preferences Saved!');
  console.log(arg);
  store.set('preferences', arg);
  const contextMenu = createTickerMenu();
  tray.setContextMenu(contextMenu);
  refresh = startRefresh();
});

const startRefresh = () => {
  const refreshRate = store.get('preferences').refreshRate * 60 * 1000;
  console.log(`Refreshing at rate: ${refreshRate}`);
  return setInterval(async () => {
    try {
      await refreshAccountData(RobinHoodAPI._accountNumber);
    } catch (e) {
      console.log('Could not refresh');
      console.log(e);
      clearInterval(refresh);
    }
  }, refreshRate);
};

const changeRefreshRate = (rate) => {
  console.log(`Changing refresh rate to: ${rate}`);
  const preferences = store.get('preferences');
  const newPreferences = Object.assign({}, preferences, { refreshRate: rate });
  store.set('preferences', newPreferences);
  clearInterval(refresh);
  refresh = startRefresh();
};

const fetchWithAuth = (url, opts) => {
  const options = Object.assign({}, opts, { headers: { Authorization: `Token ${RobinHoodAPI._token}` } });
  console.log(options)
  return fetch(url, options);
};

/*
  This method refreshes the account data and then repaints the contextmenu appropriately.
  May be called upon interval refresh or manual refresh.
*/
const refreshAccountData = async (accountNumber) => {
  /* Fetch information about a user's positions*/
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
      // console.log(RobinHoodAPI._positions);
      RobinHoodAPI._positions = transformed;
    } else {
      throw new Error('Could not retrieve positions');
    }
    /* Fetch information about a user's portfolio*/
    res = await fetchWithAuth(`https://api.robinhood.com/accounts/${accountNumber}/portfolio/`);
    json = await res.json();
    if (res.ok) {
      RobinHoodAPI._portfolio = json;
      console.log(json);
    } else {
      console.log(json);
      throw new Error('Could not retrieve portfolio');
    }

    const contextMenu = createTickerMenu();
    tray.setContextMenu(contextMenu);
    const equity = Number(RobinHoodAPI._portfolio.extended_hours_equity || RobinHoodAPI._portfolio.equity).toFixed(2);
    tray.setTitle(`$${equity}`);
  } catch (e) {
    throw e;
  }
}

// The login window.
const createLoginWindow = () => {
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

// To be displayed if the user has not authenticated yet
const createLoginMenu = () => {
  const template = [
    {
      label: 'Login',
      click: () => {
        if (win === null) {
          win = createLoginWindow();
        }

        win.loadURL(url.format({
          pathname: path.join(__dirname, 'index.html'),
          protocol: 'file:',
          slashes: true,
        }));
        // win.webContents.openDevTools({ mode: 'detach' });
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
  // Retrieve preferences + user data
  const { _portfolio: portfolio, _positions: positions } = RobinHoodAPI;
  const { viewChangeBy, viewEquityBy } = store.get('preferences');

  // Create menuItems about our individual positions
  const template = positions.map((data) => {
    let symbol = data.symbol;
    let price = Number(data.quote.last_extended_hours_trade_price) || Number(data.quote.last_trade_price);
    let oldPrice = data.quote.previous_close;
    if (viewEquityBy === 'total-equity') {
      price *= data.quantity;
      oldPrice *= data.quantity;
    } else {
      symbol += ` (${data.quantity})`
    }

    let difference = (price - oldPrice);
    const sign = difference >= 0 ? '+' : '-';
    if (viewChangeBy === 'percent') {
      difference = `${Math.abs(100 * difference/Number(oldPrice)).toFixed(4)}%`
    } else {
      difference = Math.abs(difference.toFixed(2));
    }

    return {
      label: `${symbol} | $${price.toFixed(2)} | ${sign}${difference}`,
      click: () => createStockInfoWindow(data.symbol),
    };
  });


  let dailyEquityDifference = Number(portfolio.equity) - Number(portfolio.equity_previous_close);
  console.log(dailyEquityDifference);
  const sign = dailyEquityDifference >= 0 ? '+' : '-';
  if (viewChangeBy === 'percent') {
    dailyEquityDifference = `${Math.abs(100 * dailyEquityDifference/Number(portfolio.equity_previous_close)).toFixed(4)}%`;
  } else {
    dailyEquityDifference = Math.abs(dailyEquityDifference.toFixed(2));
  }

  template.unshift(
    {
      label: `Today: ${sign}${dailyEquityDifference}`
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
      label: 'Manual Refresh',
      click: async (menuItem, browserWindow) => {
        try {
          await refreshAccountData(RobinHoodAPI._accountNumber);
        } catch (e) {
          console.error(e);
          dialog.showMessageBox({
            type: 'error',
            message: 'Unable to refresh account data.',
          });
        }
      },
    },
    {
      label: 'Preferences',
      click: () => createPreferencesWindow(),
    },
    {
      label: 'Logout',
      click: async () => {
        const res = await fetchWithAuth('https://api.robinhood.com/api-token-logout/', { method: 'POST', Accept: 'application/json' });
        RobinHoodAPI = null;
        const contextMenu = createLoginMenu();
        tray.setTitle('');
        tray.setContextMenu(contextMenu);
      },
    },
    {
      label: 'About',
      click: () => openAboutWindow({
        icon_path: ICON_LOGO_LARGE,
        copyright: 'Copyright (c) 2018 Jerry Tsui',
        package_json_dir: __dirname,
        description: 'www.github.com/peniqliotuv',
        open_devtools: process.env.NODE_ENV !== 'production',
      }),
    },
    {
      label: 'Quit',
      role: 'quit',
    },
  );
  return Menu.buildFromTemplate(template);
}

const createPreferencesWindow = () => {
  /* Prevent creation of unncessary number of windows*/
  if (preferences !== null) {
    preferences.show();
    return;
  }

  preferences = new BrowserWindow({
    height: 400,
    width: 300,
    resizable: false,
    backgroundColor: '#212025',
  });

  preferences.loadURL(url.format({
    pathname: path.join(__dirname, 'preferences.html'),
    protocol: 'file:',
    slashes: true,
  }));
  // preferences.webContents.openDevTools({ mode: 'undocked' })

  preferences.webContents.on('did-finish-load', () => {
    preferences.webContents.send('preferences', store.get('preferences'));
  });

  preferences.on('close', () => {
    preferences = null;
  });
};


const createStockInfoWindow = async (symbol) => {
  const data = await stockAPI.getSMA(symbol);
  console.log(data);
};

const isAuthenticated = () => store.get('data') ? true : false;

const initializeApp = () => {
  app.dock.hide();
  // Necessary to prevent CORS since Electron sends things with an origin of file://
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Origin'] = 'electron://robinhood-app';
    details.requestHeaders['content-type'] = 'application/json';
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  // Default preferences
  if (!store.get('preferences')) {
    store.set('preferences', {
      refreshRate: 1,
      viewChangeBy: 'gain/loss',
      viewEquityBy: 'total-equity',
    });
  }

  // Create the browser window.
  win = createLoginWindow();
  win.loadURL(url.format({
    pathname: path.join(__dirname, 'index.html'),
    protocol: 'file:',
    slashes: true,
  }));

  win.on('close', () => {
    win = null;
  });

  // if (process.env.NODE_ENV === 'development') {
    // win.openDevTools({ mode: 'detach' });
  // }

  tray = new Tray(ICON_LOGO);

  let contextMenu;
  if (isAuthenticated()) {
    RobinHoodAPI = store.get('data');
    contextMenu = createTickerMenu();
    const equity = Number(RobinHoodAPI._portfolio.extended_hours_equity || RobinHoodAPI._portfolio.equity).toFixed(2);
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
});

// Makes sure that we persist a user's data before exiting
app.on('before-quit', () => {
  store.set('data', RobinHoodAPI);
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win === null) {
    initializeApp();
  }
});

autoUpdater.on ('update-available', () => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Available!',
    buttons: ['Download'],
    icon: ICON_LOGO_LARGE,
  }, (response, checkboxChecked) => {
    console.log(response);
  });
});

autoUpdater.on('update-downloaded', () => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Successfully downloaded!',
    icon: ICON_LOGO_LARGE,
  });
});

// Necessary to authenticating requests
global.addAuthHeaders = (token) => {
  const filter = {
    urls: ['https://api.robinhood.com/accounts/*', 'https://api.robinhood.com/api-token-logout/'],
  };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    details.requestHeaders['Origin'] = 'electron://robinhood-app';
    details.requestHeaders['content-type'] = 'application/json';
    details.requestHeaders['Authorization'] = `Token ${token}`
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });
};

global.addContentTypeHeaders = () => {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Origin'] = 'electron://robinhood-app';
    details.requestHeaders['content-type'] = 'application/json';
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });
}
