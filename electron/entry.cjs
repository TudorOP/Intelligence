const { app, dialog } = require('electron');
if (process.platform !== 'linux' && process.env.INTELLIGENCE_TEST !== '1') {
  console.error('Intelligence is a Linux application. Use the development preview for UI work.');
  app.quit();
} else
  import('./main.mjs').catch((error) => {
    console.error('Intelligence could not start:', error.stack || error.message);
    if (process.env.INTELLIGENCE_TEST !== '1')
      dialog.showErrorBox('Intelligence could not start', error.message);
    app.quit();
  });
