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
    this.sender = this.smtp.auth.user;
    this.senderName = config.report.senderName;

    this.mail = nodemailer.createTransport(this.smtp);
  }

  async send(html, subject) {
    return new Promise((resolve) => {
      const from = `"${this.senderName}" <${this.sender}>`;
      const to = this.receiver;
      const opts = {
        from, to, subject, html,
      };

      this.mail.sendMail(opts, (error) => {
        this.logger.error(`fail to send email to ${to}. reason: ${error.toString()}`);
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
      e[index + 1] = { newEvents: [], oldEvents: [] };
    });

    oldEvents.forEach((event) => {
      const dayDiff = moment(event.start).diff(now, 'days');
      e[dayDiff].oldEvents.push(event);
    });

    newEvents.forEach((event) => {
      const dayDiff = moment(event.start).diff(now, 'days');
      e[dayDiff].newEvents.push(event);
    });

    /**
     * extract info from event name
     * @param {*} name
     * @return {{title, location, time}}
     */
    const processName = (name) => {
      const regex = /([^<]*?) <br\/><span title="教师考勤[^"]*?">[^<]*?<\/span> <span title="学员考勤[^"]*?">[^<]*?<\/span> <span title="校区">([^<]*?)<\/span><br\/>(.*)/;
      const execResult = regex.exec(name);

      if (!execResult) {
        this.logger.error(`no information is extracted from the event name. name ${name}`);
        return { title: '', timeAndLocation: '' };
      }

      const title = execResult[1];
      const location = execResult[2];
      const time = execResult[3];
      return { title, location, time };
    };

    const tableContent = Array(dayRange).fill(0).map((value, index) => {
      const date = moment(now).add(index + 1, 'days').format('dddd YYYY-MM-DD');
      const oldE = e[index + 1].oldEvents;
      const newE = e[index + 1].newEvents;

      const e1 = oldE.map((event) => {
        const { title, location, time } = processName(event.name);
        return ''
          + '<tr><td>'
          + `<span>${time}@${location}</span><br/>`
          + `<span>${title}</span><br/>`
          + '</td></tr>';
      }).join('');

      const e2 = newE.map((event) => {
        const { title, location, time } = processName(event.name);
        return ''
          + '<tr><td>'
          + `<span>${time}@${location}</span><br/>`
          + `<span>${title}</span><br/>`
          + '</td></tr>';
      }).join('');


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
    const startDate = now.add(1, 'days').format(dateFormat);
    const endDate = now.add(dayRange - 1, 'days').format(dateFormat);

    const result = await this.send(greeting + table, `Events Report: ${startDate} - ${endDate}`);
    if (result) this.logger.info(`sent weekly report to email ${this.receiver}.`);

    return false;
  }

  async sendTestEmail() {
    const result = await this.send('<strong>test</strong>', 'haha');
    this.logger.debug(`sent test message, result: ${result}`);
  }
};
