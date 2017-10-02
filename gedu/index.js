const { CronJob } = require('cron');
const logger = require('log4js').getLogger('main');
const utils = require('./utils');
const Report = require('./report');
const Bridge = require('./bridge');
const config = require('./config');

/**
 * Wrap the `onTick` function in `CronJob` options.
 * This wrapper redirect promise rejection to logger.
 *
 * @param {Promise<void>} func
 * @return {Promise<void>}
 */
const onTickWrapper = function onTickWrapper(func) {
  return function onTick() { func(this).catch(err => logger.error(err)); };
};

const api = new Bridge(config.server.url, config.logLevel);
const reporter = new Report(config);
const timeZone = 'Asia/Shanghai';
const jobs = [];
let events = [];
let needLogin = true;

/**
 * @return {boolean}
 */
const login = async function login() {
  logger.info('start to login');
  const loginResult = await api.login(config.server.username, config.server.password);
  logger.info(`login result: ${loginResult.success}. message: ${loginResult.message}.`);
  return loginResult.success;
};

const stopAllJobs = () => jobs.forEach(job => job.stop());

const updateEventsJob = async () => {
  if (needLogin) {
    logger.info('login is needed. jobUpdateEvents is pending.');
    return;
  }

  logger.debug('start to get events.');
  const result = await api.getEvents(new Date());
  if (!result.success) {
    logger.info('fail to get events.');

    if (result.needLogin) {
      logger.info('login session seems expired. tell login jobs to start to login.');
      needLogin = true;
      return;
    }

    logger.error('reason of failure to get events is unknown. process is about to stop.');
    stopAllJobs();
  }

  const newEvents = result.events.sort((a, b) => a.start - b.start);
  const totalHours = utils.calcHours(newEvents);
  logger.info(`events: ${newEvents.length}. total hours: ${totalHours}`);

  const oldEvents = events;
  events = newEvents;

  setImmediate(onTickWrapper(async () => {
    const oldE = utils.getRecentEvents(oldEvents, config.monitor.dayRange);
    const newE = utils.getRecentEvents(newEvents, config.monitor.dayRange);

    const compareResult = utils.compareEvents(oldE, newE);
    logger.debug(`compare result: ${JSON.stringify(compareResult)}`);
    if (!compareResult) {
      logger.info('no event changes');
      return;
    }

    logger.info('event change detects');
    await reporter.sendWeeklyReport(oldE, newE, config.monitor.dayRange);
  }));
};

const loginJob = async (ctx) => {
  if (!needLogin) return;
  ctx.stop();
  if (!await login()) stopAllJobs();
  else {
    needLogin = false;

    if (!ctx.LOGIN_INITIALIZED) {
      ctx.jobUpdateEvents.fireOnTick();
      ctx.jobUpdateEvents.start();
      ctx.LOGIN_INITIALIZED = true;
    }
  }
  ctx.start();
};

async function main() {
  logger.level = config.logLevel;
  logger.info('Sentinel of Georgina starts. :)');

  const jobUpdateEvents = new CronJob({
    cronTime: '* */30 * * * *',
    onTick: onTickWrapper(updateEventsJob),
    start: false,
    timeZone,
  });

  const jobLogin = new CronJob({
    cronTime: '* * * * * *',
    onTick: onTickWrapper(loginJob),
    start: false,
    timeZone,
  });
  jobLogin.jobUpdateEvents = jobUpdateEvents;

  jobs.push(jobUpdateEvents, jobLogin);

  jobLogin.start();
}

main().catch(err => logger.error(err));
