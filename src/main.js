import 'babel-polyfill';
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  session,
  ipcMain,
  dialog
} from 'electron';
import AutoLaunch from 'auto-launch';
import electronReload from 'electron-reload';
import fetch from 'node-fetch';
import path from 'path';
import url from 'url';
import openAboutWindow from 'about-window';
import menubar from 'menubar';
import {
  appUpdater
} from './app-updater';
import log from 'electron-log';
import {
  timeout,
  TimeoutError
} from './utils/timeout.js';
import Store from 'electron-store';
import StockAPI from './StockAPI';

const store = new Store();

const ICON_LOGO_LARGE = path.join(__dirname, '../assets/logo-512.png');
const ICON_LOGO = path.join(__dirname, '../assets/logo-16.png');

const TIMEOUT_MS = 5000;
console.log(`APP START: NODE_ENV: ${process.env.NODE_ENV}`);
if (process.env.NODE_ENV === 'development') {
  electronReload(__dirname, {
    electron: require(path.join(__dirname, '../node_modules/electron'))
  });
  require('electron-debug')();
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
  RobinHoodAPI = arg;
  store.set('data', RobinHoodAPI);
  const equity = Number(
    RobinHoodAPI._portfolio.extended_hours_equity ||
    RobinHoodAPI._portfolio.equity
  ).toFixed(2);
  if (mb === null) {
    tray.destroy();
    tray = new Tray(ICON_LOGO);
    mb = menubar({
      dir: __dirname,
      icon: ICON_LOGO,
      preloadWindow: true,
      index: `file://${__dirname}/views/menubar.html`,
      width: 250,
      height: 500,
      tray,
      resizable: false,
      alwaysOnTop: true,
      webPreferences: {
        experimentalFeatures: true
      }
    });
    mb.window.webContents.on('did-finish-load', () => {
      mb.window.webContents.send('data', {
        data: RobinHoodAPI,
        preferences: store.get('preferences')
      });
    });
    mb.on('show', () => {
      mb.window.webContents.send('data', {
        data: RobinHoodAPI,
        preferences: store.get('preferences')
      });
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
  mb.window.webContents.send('data', {
    data: RobinHoodAPI,
    preferences: store.get('preferences')
  });
  refresh = startRefresh();
});

ipcMain.on('open-preferences', (event, symbol) => {
  createPreferencesWindow();
});

ipcMain.on('chart', (event, symbol) => {
  createStockWindow(symbol);
});

ipcMain.on('logout', async (event, arg) => {
  try {
    const res = await fetchWithAuth(
      'https://api.robinhood.com/api-token-logout/', {
        method: 'POST',
        Accept: 'application/json'
      }
    );
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
    mb.window.webContents.send('data', {
      data: RobinHoodAPI,
      preferences: store.get('preferences')
    });
  } catch (e) {
    console.error('***************************************');
    console.error(e);
    console.error(e.stack);
  }
});

ipcMain.on('app-quit', (event, arg) => {
  app.quit();
});

ipcMain.on('show-about', (event, arg) => {
  openAboutWindow({
    icon_path: ICON_LOGO_LARGE,
    copyright: 'Copyright (c) 2018 Jerry Tsui',
    package_json_dir: __dirname,
    description: 'www.github.com/peniqliotuv'
  });
});

const startRefresh = () => {
  const refreshRate = store.get('preferences').refreshRate * 60 * 1000;
  console.log(`Refreshing at rate: ${refreshRate}`);
  return setInterval(async () => {
    try {
      await refreshAccountData(RobinHoodAPI._accountNumber);
      console.log('Finished automatic refresh.');
      mb.window.webContents.send('data', {
        data: RobinHoodAPI,
        preferences: store.get('preferences')
      });
    } catch (e) {
      console.log('Could not refresh');
      console.log(e);
      clearInterval(refresh);
    }
  }, refreshRate);
};

const changeRefreshRate = rate => {
  console.log(`Changing refresh rate to: ${rate}`);
  const preferences = store.get('preferences');
  const newPreferences = Object.assign({}, preferences, {
    refreshRate: rate
  });
  store.set('preferences', newPreferences);
  clearInterval(refresh);
  refresh = startRefresh();
};

const fetchWithAuth = (url, opts) => {
  const options = Object.assign({}, opts, {
    headers: {
      Authorization: `Token ${RobinHoodAPI._token}`
    }
  });
  return timeout(TIMEOUT_MS, fetch(url, options));
};

/*
  This method refreshes the account data and then repaints the contextmenu appropriately.
  May be called upon interval refresh or manual refresh.
*/
const refreshAccountData = async accountNumber => {
  /* Fetch information about a user's positions*/
  try {
    console.time('refreshAccountData');
    await Promise.all([
      refreshPositions(accountNumber),
      refreshPortfolio(accountNumber),
      refreshWatchlist()
    ]);
    console.timeEnd('refreshAccountData');
    const equity = Number(
      RobinHoodAPI._portfolio.extended_hours_equity ||
      RobinHoodAPI._portfolio.equity
    ).toFixed(2);
    tray.setTitle(`$${equity}`);
    mb.tray.setTitle(`${equity}`);
  } catch (e) {
    if (e instanceof TimeoutError) {
      console.error('Timeout Error', e);
    }
  }
};

const refreshPositions = async accountNumber => {
  console.time('refreshPositions');
  try {
    const res = await fetchWithAuth(
      `https://api.robinhood.com/accounts/${accountNumber}/positions/`
    );
    const json = await res.json();
    if (res.ok) {
      const transformed = await Promise.all(
        json.results
        .filter(result => Number(result.quantity) !== 0)
        .map(async result => {
          const instrument = await (await fetchWithAuth(
            decodeURIComponent(result.instrument)
          )).json();
          const quote = await (await fetchWithAuth(
            decodeURIComponent(instrument.quote)
          )).json();
          return {
            averageBuyPrice: result.average_buy_price,
            instrument: result.instrument,
            quantity: Number(result.quantity),
            quote: quote,
            currentPrice: quote.last_traded_price,
            symbol: instrument.symbol,
            name: instrument.name,
            instrument: instrument
          };
        })
      );
      RobinHoodAPI._positions = transformed;
    } else {
      throw new Error('Could not retrieve positions');
    }
  } catch (e) {
    if (e instanceof TimeoutError) {
      console.error('Timeout Error', e);
    }
  }
  console.timeEnd('refreshPositions');
};

const refreshPortfolio = async accountNumber => {
  console.time('refreshPortfolio');
  try {
    const res = await fetchWithAuth(
      `https://api.robinhood.com/accounts/${accountNumber}/portfolio/`
    );
    const json = await res.json();
    if (res.ok) {
      RobinHoodAPI._portfolio = json;
    } else {
      throw new Error('Could not retrieve portfolio');
    }
  } catch (e) {
    console.error(e);
  }
  console.timeEnd('refreshPortfolio');
};

const refreshWatchlist = async () => {
  console.time('refreshWatchlist');
  try {
    const res = await fetchWithAuth(
      'https://api.robinhood.com/watchlists/Default/'
    );
    const json = await res.json();
    if (res.ok) {
      const watchlistInstruments = await Promise.all(
        json.results.map(async result => {
          return await (await fetchWithAuth(
            decodeURIComponent(result.instrument)
          )).json();
        })
      );
      const querystring = watchlistInstruments
        .map(instrument => instrument.symbol)
        .join(',');
      const {
        results: watchlistQuotes
      } = await (await fetchWithAuth(
        `https://api.robinhood.com/quotes/?symbols=${querystring}`
      )).json();
      RobinHoodAPI._watchlist = watchlistQuotes.filter(quote => {
        for (let position of RobinHoodAPI._positions) {
          if (position.symbol === quote.symbol) {
            return false;
          }
        }
        return true;
      });
    }
    console.timeEnd('refreshWatchlist');
  } catch (e) {
    console.error('Error In refreshWatchlist');
    if (e instanceof TimeoutError) {
      console.error('Timeout Error', e);
    }
  }
};

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
    show: false
  });
};

// To be displayed if the user has not authenticated yet
const createLoginMenu = () => {
  const template = [{
    label: 'Login',
    click: () => {
      if (win === null) {
        win = createLoginWindow();
      }

      win.loadURL(
        url.format({
          pathname: path.join(__dirname, 'views/index.html'),
          protocol: 'file:',
          slashes: true
        })
      );
      win.on('close', () => {
        win = null;
      });
      win.webContents.on('did-finish-load', () => win.show());
    }
  }];
  template.push({
    type: 'separator'
  }, {
    label: 'Quit',
    click: () => app.quit()
  });
  return Menu.buildFromTemplate(template);
};

const createStockWindow = async symbol => {
  let data;
  try {
    data = await StockAPI.getSMA(symbol);
  } catch (e) {
    console.error('ERROR: ' + e);
    return;
  }

  console.log('DATA: ');
  console.log(data);
  if (stockInfoWindow !== null) {
    stockInfoWindow.destroy();
  }
  stockInfoWindow = new BrowserWindow({
    width: 825,
    height: 600,
    backgroundColor: '#212025',
    center: true,
    title: symbol,
    resizable: false,
    titleBarStyle: 'hidden',
    show: true,
  });
  stockInfoWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, 'views/stock.html'),
      protocol: 'file:',
      slashes: true
    })
  );

  stockInfoWindow.webContents.on('did-finish-load', () => {
    stockInfoWindow.webContents.send('data', data);
  });

  stockInfoWindow.on('close', () => {
    stockInfoWindow = null;
  });
};

const createPreferencesWindow = () => {
  /* Prevent creation of unncessary number of windows*/
  if (preferences !== null) {
    preferences.show();
    return;
  }

  preferences = new BrowserWindow({
    height: 400,
    width: 275,
    resizable: false,
    backgroundColor: '#212025',
    titleBarStyle: 'hidden'
  });

  preferences.loadURL(
    url.format({
      pathname: path.join(__dirname, 'views/preferences.html'),
      protocol: 'file:',
      slashes: true
    })
  );

  preferences.webContents.on('did-finish-load', () => {
    preferences.webContents.send('preferences', store.get('preferences'));
  });

  preferences.on('close', () => {
    preferences = null;
  });
};

const isAuthenticated = () => (store.get('data') ? true : false);

const initializeApp = () => {
  app.dock.hide();

  const autoLaunch = new AutoLaunch({
    name: 'RH-Ticker',
    path: '/Applications/RH-Ticker.app',
    isHidden: true
  });
  autoLaunch.isEnabled().then(isEnabled => {
    if (!isEnabled) autoLaunch.enable();
  });

  // Necessary to prevent CORS since Electron sends things with an origin of file://
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Origin'] = 'electron://robinhood-app';
    details.requestHeaders['content-type'] = 'application/json';
    callback({
      cancel: false,
      requestHeaders: details.requestHeaders
    });
  });

  // Default preferences
  if (!store.get('preferences')) {
    store.set('preferences', {
      refreshRate: 1,
      viewChangeBy: 'gain/loss',
      viewEquityBy: 'total-equity'
    });
  }

  // Create the browser window.
  win = createLoginWindow();
  win.loadURL(
    url.format({
      pathname: path.join(__dirname, 'index.html'),
      protocol: 'file:',
      slashes: true
    })
  );

  win.on('close', () => {
    win = null;
  });

  tray = new Tray(ICON_LOGO);

  let contextMenu;
  if (isAuthenticated()) {
    console.log('authenticated');
    RobinHoodAPI = store.get('data');
    const equity = Number(
      RobinHoodAPI._portfolio.extended_hours_equity ||
      RobinHoodAPI._portfolio.equity
    ).toFixed(2);
    global.addAuthHeaders(RobinHoodAPI._token);
    mb = menubar({
      dir: __dirname,
      icon: ICON_LOGO,
      preloadWindow: true,
      index: `file://${__dirname}/views/menubar.html`,
      width: 250,
      height: 500,
      tray,
      alwaysOnTop: true,
      resizable: false,
      webPreferences: {
        experimentalFeatures: true
      }
    });
    mb.tray.setTitle(`$${equity}`);
    mb.window.webContents.on('did-finish-load', () => {
      mb.window.webContents.send('data', {
        data: RobinHoodAPI,
        preferences: store.get('preferences')
      });
    });
    mb.on('show', () => {
      mb.window.webContents.send('data', {
        data: RobinHoodAPI,
        preferences: store.get('preferences')
      });
    });
    mb.on('hide', () => console.log('MenuBar hidden'));
    mb.window.webContents.once('did-frame-finish-load', () => {
      /* Check for auto updates */
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
global.addAuthHeaders = token => {
  const filter = {
    urls: [
      'https://api.robinhood.com/accounts/*',
      'https://api.robinhood.com/api-token-logout/'
    ]
  };
  session.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      details.requestHeaders['Origin'] = 'electron://robinhood-app';
      details.requestHeaders['content-type'] = 'application/json';
      details.requestHeaders['Authorization'] = `Token ${token}`;
      callback({
        cancel: false,
        requestHeaders: details.requestHeaders
      });
    }
  );
};

global.addContentTypeHeaders = () => {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Origin'] = 'electron://robinhood-app';
    details.requestHeaders['content-type'] = 'application/json';
    callback({
      cancel: false,
      requestHeaders: details.requestHeaders
    });
  });
};
