const requestDefaultOptions = {
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'THaGKi9/1.0.0',
    'Accept-Language': 'en-US,en;q=0.8',
  },
  gzip: true,
  strictSSL: false,
  resolveWithFullResponse: true,
};

const log4js = require('log4js');
const moment = require('moment');
const request = require('request-promise').defaults(requestDefaultOptions);
const tough = require('tough-cookie');


module.exports = class Bridge {
  /**
   * @constructor
   * @param {string} url 服务器地址
   * @param {string} logLevel 日志等级
   */
  constructor(url, logLevel) {
    this.url = url;
    this.jar = request.jar();
    this.logger = log4js.getLogger('bridge');
    this.logger.level = logLevel;
  }

  /**
   * login to the server and get cookies about authentication
   *
   * @param {string} url 服务器地址
   * @param {string} username 用户名
   * @param {string} password 密码
   * @return {{success: boolean, message: string}}
   */
  async login(username, password) {
    const options = {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
    };

    const resp = await request
      .post(`${this.url}/ajax/TeacherLogin.ashx`, options)
      .form({ username, password: `${password}` });


    if (resp.statusCode !== 200) {
      this.logger.debug(`login failed. status code: ${resp.statusCode}`);
      return { success: false, message: `登陆失败，状态码：${resp.statusCode}` };
    }

    const { body } = resp;
    const message = /<data>([^<]*?)<\/data>/.exec(body || '')[1];

    if (message !== '1') {
      this.logger.debug(`login failed. message: ${message}`);
      return { success: false, message: `登陆失败，理由：${message}` };
    }

    this.logger.debug(`login success with username ${username}`);
    const cookies = [].concat(resp.headers['set-cookie'] || []);

    const jar = request.jar();
    cookies
      .map(cookieStr => tough.Cookie.parse(cookieStr))
      .forEach(cookie => jar.setCookie(cookie, this.url));
    this.jar = jar;

    return { success: true };
  }

  /**
   * Extract url `/extnet/extnet-init-js/ext.axd?144ab5dcab284d518c2de3e8595de9c9`
   * from the view calendar page of the admin panel.
   *
   * This url is a link to a javascript file that contain event datas.
   *
   * @param {Date} date
   * @return {{success: boolean, dataUrl: string, pageUrl: string}}
   */
  async getEventDataUrl(date) {
    const url = `${this.url}/Teacher/TeacherClass.aspx`;
    const time = moment(date).format('YYYY-MM-DD');
    const resp = await request.get(url, { jar: this.jar }).qs({ time });

    const checkResult = this.checkResult(resp);
    if (checkResult) return checkResult;

    const { body } = resp;
    const dataScriptUrl = /src="(\/extnet\/extnet-init-js\/ext\.axd\?[0-9a-z]*?)"/.exec(body || '')[1];
    this.logger.debug(`got event data url: ${dataScriptUrl}`);
    if (dataScriptUrl === '') {
      this.logger.warn(`get event data url failed. reason: regular expression does not match any url. body: ${body}`);
    }
    return { success: true, dataUrl: dataScriptUrl, pageUrl: url };
  }

  /**
   * Extract and parse events from a script.
   *
   * @param {Data} date
   * @return {{success: boolean, events: {name: string, start: Date, end: Date}[]}}
   */
  async getEvents(date) {
    const getEventDataUrlResult = await this.getEventDataUrl(date);
    if (!getEventDataUrlResult.success) return getEventDataUrlResult;

    const { dataUrl, pageUrl } = getEventDataUrlResult;
    const options = {
      jar: this.jar,
      headers: { Referer: pageUrl },
    };
    const resp = await request.get(this.url + dataUrl, options);

    const checkResult = this.checkResult(resp);
    if (checkResult) return checkResult;

    // extract events from the script
    const rawEventData = /,idProperty:"EventId"}\),directEventConfig:{},proxy:new Ext.data.PagingMemoryProxy\((\[.*?\]), false\)}\),monthViewCfg/.exec(resp.body)[1];
    if (!rawEventData) {
      this.logger.error(`get no event data from the script. script: ${rawEventData}`);
    }

    try {
      /** @type {{Title: string, StartDate: string, EndDate: String}[]} */
      const eventData = JSON.parse(rawEventData) || [];
      const events = eventData.map((event) => {
        const { title, location, time } = this.processName(event.Title);
        const start = new Date(event.StartDate);
        const end = new Date(event.EndDate);
        return {
          title,
          location,
          time,
          start,
          end,
        };
      });

      return { success: true, events };
    } catch (err) {
      this.logger.error(`parse event data failed. data: ${rawEventData}. error: ${err}`);
      throw err;
    }
  }

  /**
   * check request status
   *
   * @param {*} response
   */
  checkResult(response) {
    if (response.request.uri.href.startsWith('https://teacher.gedu.org:9003/Default.aspx?ReturnUrl=')) {
      this.logger.debug('login session is expired. relogin is needed');
      return { success: false, needLogin: true };
    }

    return null;
  }

  processName(name) {
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
  }
};

