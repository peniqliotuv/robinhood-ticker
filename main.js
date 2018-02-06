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

const ICON_LOGO_LARGE = `${__dirname}/logo-large.png`;
const ICON_LOGO = `${__dirname}/logo.png`;

if (process.env.NODE_ENV === 'development') {
  console.info('Electron is reloading');
  require('electron-reload')(__dirname, {
    electron: require(`${__dirname}/node_modules/electron`)
  });
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.

let preferences = null;
let RobinHoodAPI = null;
let tray = null;
let win = null;
// Set this to the value of setTimeout()
let refresh;

ipcMain.on('data', (event, arg) => {
  console.log('data received from IPC');
  RobinHoodAPI = arg;
  store.set('data', RobinHoodAPI);
  const contextMenu = createTickerMenu();
  tray.setContextMenu(contextMenu);
  tray.popUpContextMenu(contextMenu);
  refresh = startRefresh();
});

ipcMain.on('preferences-saved', (event, arg) => {
  console.log('Preferences Saved!');
  console.log(arg);
  store.set('preferences', arg);
  const contextMenu = createTickerMenu();
  tray.setContextMenu(contextMenu);
  tray.popUpContextMenu(contextMenu);
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


/*
  This method refreshes the account data and then repaints the contextmenu appropriately.
  May be called upon interval refresh or manual refresh.
*/
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

    const contextMenu = createTickerMenu();
    tray.setContextMenu(contextMenu);
    const equity = Number(RobinHoodAPI._portfolio.equity).toFixed(2);
    tray.setTitle(`$${equity}`);
  } catch (e) {
    throw e;
  }
}

// The login window
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
  const { viewBy } = store.get('preferences');

  // Create menuItems about our individual positions
  const template = positions.map((data) => {
    const price = (data.quantity * Number(data.quote.last_trade_price));
    const oldPrice = data.quantity * data.quote.previous_close;
    let difference = (price - oldPrice);
    const sign = difference >= 0 ? '+' : '-';
    if (viewBy === 'percent') {
      difference = `${Math.abs(100 * difference/Number(oldPrice)).toFixed(4)}%`
    } else {
      difference = Math.abs(difference.toFixed(2));
    }
    return {
      label: `${data.symbol} | $${price.toFixed(2)} | ${sign}${difference}`,
      click: () => {},
    };
  });


  let dailyEquityDifference = Number(portfolio.equity) - Number(portfolio.equity_previous_close);
  console.log(dailyEquityDifference);
  const sign = dailyEquityDifference >= 0 ? '+' : '-';
  if (viewBy === 'percent') {
    dailyEquityDifference = `${Math.abs(dailyEquityDifference/Number(portfolio.equity_previous_close)).toFixed(4)}%`;
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
  const APP_VERSION = app.getVersion();
  dialog.showMessageBox({
    type: 'info',
    title: 'About',
    message: `RobinHood Ticker ${APP_VERSION}\n\nYour information is NEVER stored or collected. \n\nFind me on www.github.com/peniqliotuv`,
    icon: ICON_LOGO_LARGE,
  });
}

const createPreferencesWindow = () => {
  preferences = new BrowserWindow({
    height: 400,
    width: 300,
    resizable: false,
  });

  if (process.env.NODE_ENV === 'development') {
    preferences.webContents.openDevTools({ mode: 'detach' });
  }

  preferences.loadURL(url.format({
    pathname: path.join(__dirname, 'preferences.html'),
    protocol: 'file:',
    slashes: true,
  }));


  preferences.webContents.on('did-finish-load', () => {
    preferences.webContents.send('preferences', store.get('preferences'));
  });


  preferences.on('close', () => {
    preferences = null;
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
  // Default preferences
  if (!store.get('preferences')) {
    store.set('preferences', {
      refreshRate: 1,
      viewBy: 'gain/loss',
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

  if (process.env.NODE_ENV === 'development') {
    win.openDevTools();
  }

  tray = new Tray(ICON_LOGO);

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
  console.log('adding auth headers' + token);
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Origin'] = 'electron://robinhood-app';
    details.requestHeaders['content-type'] = 'application/json';
    details.requestHeaders['Authorization'] = `Token ${token}`
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });
}
