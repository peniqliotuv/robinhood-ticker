const os = require('os');
const log = require('electron-log');
log.transports.file.format = '{h}:{i}:{s}:{ms} {text}';
log.transports.file.level = 'info';
const { app, autoUpdater, dialog } = require('electron');
const version = app.getVersion();
const platform = os.platform() + '_' + os.arch();  // usually returns darwin_64
const updaterFeedURL = `https://rh-ticker-deploy-server.herokuapp.com/update/${platform}/${version}`;

function appUpdater() {

  log.error('Starting app update! ' + updaterFeedURL);
  autoUpdater.setFeedURL(updaterFeedURL);
  /* Log whats happening
  TODO send autoUpdater events to renderer so that we could console log it in developer tools
  You could alsoe use nslog or other logging to see what's happening */
  autoUpdater.on('error', err => log.error(JSON.stringify(err)));
  autoUpdater.on('checking-for-update', () => log.error('checking-for-update'));
  autoUpdater.on('update-available', () => log.error('update-available'));
  autoUpdater.on('update-not-available', () => log.error('update-not-available'));

  // Ask the user if update is available
  autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
    let message = app.getName() + ' ' + releaseName + ' is now available. It will be installed the next time you restart the application.';
    if (releaseNotes) {
      const splitNotes = releaseNotes.split(/[^\r]\n/);
      message += '\n\nRelease notes:\n';
      splitNotes.forEach(notes => {
        message += notes + '\n\n';
      });
    }
    // Ask user to update the app
    dialog.showMessageBox({
      type: 'question',
      buttons: ['Install and Relaunch', 'Later'],
      defaultId: 0,
      message: 'A new version of ' + app.getName() + ' has been downloaded',
      detail: message
    }, response => {
      if (response === 0) {
        setTimeout(() => autoUpdater.quitAndInstall(), 1);
      }
    });
  });
  // init for updates
  autoUpdater.checkForUpdates();
}

exports = module.exports = {
  appUpdater
};
