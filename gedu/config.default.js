module.exports = {
  server: {
    url: '',
    username: '',
    password: '',
  },
  monitor: {
    dayRange: 7,
  },
  logLevel: 'debug',
  report: {
    receiver: '',
    senderName: '',
    cc: '',
    smtp: {
      host: '',
      port: 465,
      secure: true,
      auth: {
        user: '',
        pass: '',
      },
    },
  },
};
