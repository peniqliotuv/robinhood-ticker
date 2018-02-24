const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  session,
  ipcMain,
  dialog,
  globalShortcut,
} = require('electron');

const fetch = require('node-fetch');
const path = require('path');
const url = require('url');
const openAboutWindow = require('about-window').default;
const menubar = require('menubar');
const { appUpdater } = require('./app-updater');
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

// menubar
let mb = null;
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
  const equity = Number(RobinHoodAPI._portfolio.extended_hours_equity || RobinHoodAPI._portfolio.equity).toFixed(2);
  if (mb === null) {
    console.log('mb === null, creating mb');
    tray.destroy();
    tray = new Tray(ICON_LOGO);
    mb = menubar({
      dir: __dirname,
      icon: `${__dirname}/assets/logo-16.png`,
      preloadWindow: true,
      index: `file://${__dirname}/views/menubar.html`,
      width: 250,
      height: 500,
      tray,
    });
    mb.window.webContents.on('did-finish-load', () => {
      mb.window.webContents.send('data', { data: RobinHoodAPI, preferences: store.get('preferences') });
    });
    mb.on('show', () => {
      mb.window.webContents.send('data', { data: RobinHoodAPI, preferences: store.get('preferences') });
      // mb.window.openDevTools({ mode: 'undocked' });
    });
    mb.on('hide', () => console.log('MenuBar hidden'));
  }
  mb.tray.setTitle(`$${equity}`);
  refresh = startRefresh();
});

ipcMain.on('preferences-saved', (event, arg) => {
  console.log('Preferences Saved!');
  console.log(arg);
  store.set('preferences', arg);
  mb.window.webContents.send('data', { data: RobinHoodAPI, preferences: store.get('preferences') });
  refresh = startRefresh();
});

ipcMain.on('show-stock-info', (event, arg) => {
  const { symbol, color } = arg;
  createStockInfoWindow(symbol, color);
});

ipcMain.on('open-preferences', (event, symbol) => {
  createPreferencesWindow();
});

ipcMain.on('logout', async (event, arg) => {
  try {
    const res = await fetchWithAuth('https://api.robinhood.com/api-token-logout/', { method: 'POST', Accept: 'application/json' });
    RobinHoodAPI = null;
    const contextMenu = createLoginMenu();
    mb.tray.setTitle('');
    mb.tray.setContextMenu(contextMenu);
    mb = null;
    if (preferences !== null) {
      preferences.close();
    }
  } catch (e) {
    console.error(e);
    console.error(e.stack);
  }
});

ipcMain.on('manual-refresh', async (event, arg) => {
  console.log('Manual Refresh received');
  try {
    await refreshAccountData(RobinHoodAPI._accountNumber);
    console.log('Finished manual refresh.');
    mb.window.webContents.send('data', { data: RobinHoodAPI, preferences: store.get('preferences') });
  } catch (e) {
    console.error('***************************************')
    console.error(e);
    console.error(e.stack);
  }
});

ipcMain.on('app-quit', (event, arg) => {
  app.quit();
});

ipcMain.on('show-about', (event, arg) => {

  console.log('show about');

  openAboutWindow({
    icon_path: ICON_LOGO_LARGE,
    copyright: 'Copyright (c) 2018 Jerry Tsui',
    package_json_dir: __dirname,
    description: 'www.github.com/peniqliotuv',
  });

});

const startRefresh = () => {
  const refreshRate = store.get('preferences').refreshRate * 60 * 1000;
  console.log(`Refreshing at rate: ${refreshRate}`);
  return setInterval(async () => {
    try {
      await refreshAccountData(RobinHoodAPI._accountNumber);
      console.log('Finished automatic refresh.');
      mb.window.webContents.send('data', { data: RobinHoodAPI, preferences: store.get('preferences') });
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
      console.log('Robinhood API Portfolio')
      console.log(json);
    } else {
      console.log(json);
      throw new Error('Could not retrieve portfolio');
    }

    const equity = Number(RobinHoodAPI._portfolio.extended_hours_equity || RobinHoodAPI._portfolio.equity).toFixed(2);
    tray.setTitle(`$${equity}`);
    mb.tray.setTitle(`${equity}`);
  } catch (e) {
    console.error(e);
    console.log('ERROR NAME');
    console.log(e.name);
    console.error(e.stack);
    // throw e;
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
    titleBarStyle: 'hidden',
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
          pathname: path.join(__dirname, 'views/index.html'),
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

const createPreferencesWindow = () => {
  /* Prevent creation of unncessary number of windows*/
  if (preferences !== null) {
    preferences.show();
    return;
  }

  preferences = new BrowserWindow({
    height: 475,
    width: 300,
    resizable: false,
    backgroundColor: '#212025',
    titleBarStyle: 'hidden',
  });

  preferences.loadURL(url.format({
    pathname: path.join(__dirname, 'views/preferences.html'),
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


const createStockInfoWindow = (symbol, color) => {
  if (stockInfoWindow !== null) {
    // Don't allow multiple stock info windows
    stockInfoWindow.close();
  }

  stockInfoWindow = new BrowserWindow({
    height: 750,
    width: 1100,
    resizable: false,
    title: `${symbol}`,
    backgroundColor: '#212025',
    titleBarStyle: 'hidden',
  });
  stockInfoWindow.loadURL(url.format({
    pathname: path.join(__dirname, 'views/chart.html'),
    protocol: 'file:',
    slashes: true,
  }));

  // stockInfoWindow.webContents.openDevTools({ mode: 'undocked' })

  stockInfoWindow.webContents.on('did-finish-load', () => {
    stockInfoWindow.webContents.send('data', { symbol, color });
  });

  stockInfoWindow.on('close', () => {
    stockInfoWindow = null;
  });
};

const isAuthenticated = () => store.get('data') ? true : false;

const initializeApp = () => {
  app.dock.hide();
  app.setLoginItemSettings({ openAtLogin: true });
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


  tray = new Tray(ICON_LOGO);

  let contextMenu;
  if (isAuthenticated()) {
    console.log('authenticated')
    RobinHoodAPI = store.get('data');
    const equity = Number(RobinHoodAPI._portfolio.extended_hours_equity || RobinHoodAPI._portfolio.equity).toFixed(2);
    global.addAuthHeaders(RobinHoodAPI._token);
    mb = menubar({
      dir: __dirname,
      icon: `${__dirname}/assets/logo-16.png`,
      preloadWindow: true,
      index: `file://${__dirname}/views/menubar.html`,
      width: 250,
      height: 500,
      // alwaysOnTop: true,
      tray,
    });

    mb.tray.setTitle(`$${equity}`);
    mb.window.webContents.on('did-finish-load', () => {
      mb.window.webContents.send('data', { data: RobinHoodAPI, preferences: store.get('preferences') });
    });
    mb.on('show', () => {
      mb.window.webContents.send('data', { data: RobinHoodAPI, preferences: store.get('preferences') });
      // mb.window.openDevTools({ mode: 'undocked' });
    });
    mb.on('hide', () => console.log('MenuBar hidden'));
    mb.window.webContents.once('did-frame-finish-load', () => {
      /* Check for auto updates */
      console.log('did frame finish load')
      if (process.platform === 'darwin') {
        appUpdater();
      }
    });

    refresh = startRefresh();
  } else {
    console.log('not authenticated');
    contextMenu = createLoginMenu();
    tray.setContextMenu(contextMenu);
  }

  // Emitted when the window is closed.
  tray.on('closed', () => {
    tray = null;
  });

  globalShortcut.register('Command+R', async () => {
    mb.window.webContents.send('command-r');
    try {
      await refreshAccountData(RobinHoodAPI._accountNumber);
      mb.window.webContents.send('data', { data: RobinHoodAPI, preferences: store.get('preferences') });
    } catch (e) {
      console.error(e);
      console.error(e.stack);
    }
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
