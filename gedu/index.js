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
  const oldEvents = events;
  events = newEvents;

  setImmediate(onTickWrapper(async () => {
    let changed = false;
    const prev = utils.getRecentEvents(oldEvents, config.monitor.dayRange);
    const curr = utils.getRecentEvents(newEvents, config.monitor.dayRange);

    const prevHours = utils.calcHours(prev);
    const currHours = utils.calcHours(curr);

    if (prevHours !== currHours || prev.length !== curr.length) {
      logger.debug('' +
        `previou: ${prevHours}hrs(${prev.length}), ` +
        `current: ${currHours}hrs(${curr.length})`);
      changed = true;
    } else {
      for (let index = 0; index < prev.length; index += 1) {
        changed = !(+prev[index].start === +curr[index].start
          && +prev[index].end === +curr[index].end
          && prev[index].name === curr[index].name);

        if (changed) {
          logger.debug(`old event: ${JSON.stringify(prev[index])}`);
          logger.debug(`new event: ${JSON.stringify(curr[index])}`);
          logger.debug('compare detail: '
            + `start: ${+prev[index].start === +curr[index].start} `
            + `end: ${+prev[index].end === +curr[index].end} `
            + `name: ${prev[index].name === curr[index].name}`);

          break;
        }
      }
    }

    if (!changed) {
      logger.info('no event changes');
      return;
    }

    logger.info('event change detects');
    await reporter.sendWeeklyReport(prev, curr, config.monitor.dayRange);
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
    cronTime: '*/30 * * * * *',
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
