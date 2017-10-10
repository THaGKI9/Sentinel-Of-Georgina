const Promise = require('bluebird');
const log4js = require('log4js');
const moment = require('moment');
const nodemailer = require('nodemailer');


module.exports = class Report {
  constructor(config) {
    this.logger = log4js.getLogger('reporter');
    this.logger.level = config.logLevel;

    this.smtp = config.report.smtp;
    this.receiver = config.report.receiver;
    this.cc = config.report.cc;
    this.sender = this.smtp.auth.user;
    this.senderName = config.report.senderName;

    this.mail = nodemailer.createTransport(this.smtp);
  }

  async send(html, subject) {
    return new Promise((resolve) => {
      const from = `"${this.senderName}" <${this.sender}>`;
      const to = this.receiver;
      const { cc } = this;
      const opts = {
        from, to, cc, subject, html,
      };

      this.logger.debug(`send email options ${JSON.stringify(opts)}`);

      this.mail.sendMail(opts, (error) => {
        if (error) {
          this.logger.error(`fail to send email to ${to}. reason: ${error.toString()}`);
        }
        resolve(!error);
      });
    });
  }
  /**
   * @param {{name: string, start: Date, end: Date}[]} oldEvents
   * @param {{name: string, start: Date, end: Date}[]} newEvents
   * @param {number} dayRange
   * @return {{prevHours: number, currHours: number}}
   */
  async sendWeeklyReport(oldEvents, newEvents, dayRange) {
    const now = moment();

    /** @type {{[day: number]: {newEvents: [], oldEvents: []}} */
    const e = {};
    Array(dayRange).fill(0).forEach((value, index) => {
      e[index] = { newEvents: [], oldEvents: [] };
    });

    const nowToCompare = now.clone().startOf('day');
    oldEvents.forEach((event) => {
      const dayDiff = moment(event.start).startOf('day').diff(nowToCompare, 'days');
      e[dayDiff].oldEvents.push(event);
    });

    newEvents.forEach((event) => {
      const dayDiff = moment(event.start).startOf('day').diff(nowToCompare, 'days');
      e[dayDiff].newEvents.push(event);
    });

    const tableContent = Array(dayRange).fill(0).map((value, index) => {
      const date = moment(now).add(index, 'days').format('dddd YYYY-MM-DD');
      const oldE = e[index].oldEvents;
      const newE = e[index].newEvents;

      const e1 = oldE.map(({ title, location, time }) => ''
          + '<tr><td>'
          + `<span>${time}@${location}</span><br/>`
          + `<span>${title}</span><br/>`
          + '</td></tr>').join('');

      const e2 = newE.map(({ title, location, time }) => ''
          + '<tr><td>'
          + `<span>${time}@${location}</span><br/>`
          + `<span>${title}</span><br/>`
          + '</td></tr>').join('');

      return ''
        + `<tr><td align="center" colspan="2">${date}</td></tr>`
        + '<tr>'
        + `<td>${e1 === '' ? '<center>Free</center>' : `<table cellspacing="10px">${e1}</table>`}</td>`
        + `<td>${e2 === '' ? '<center>Free</center>' : `<table cellspacing="10px">${e2}</table>`}</td>`
        + '</tr>';
    }).join('');

    const table = ''
      + '<table border="1" cellpadding="5px" style="border-collapse: collapse;">'
      + '<tr><th width="50%">Old events</th><th width="50%">New events</th></tr>'
      + `${tableContent}`
      + '</table>';

    const greeting = `<p>Dear Georgina, your recent ${dayRange} day(s) events have been update. </p>`;

    const dateFormat = 'MM-DD';
    const startDate = now.clone().format(dateFormat);
    const endDate = now.clone().add(dayRange - 1, 'days').format(dateFormat);

    const result = await this.send(greeting + table, `Events Report: ${startDate} - ${endDate}`);
    if (result) this.logger.info(`sent weekly report to email ${this.receiver}.`);

    return false;
  }

  async sendTestEmail() {
    this.logger.info(`start to send test message to email ${this.receiver}.`);
    const result = await this.send('<strong>test</strong>', 'haha');
    this.logger.info(`sent test message, result: ${JSON.stringify(result)}`);
  }
};
