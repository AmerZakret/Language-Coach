const turn = () => new Promise(resolve => setImmediate(resolve));
function locks() {
  const held = new Map(), queues = new Map();
  function next(name) {
    if (held.has(name)) return;
    const job = queues.get(name)?.shift();
    if (!job) return;
    held.set(name, job);
    Promise.resolve().then(() => job.work({name, mode:'exclusive'})).then(job.resolve, job.reject).finally(() => {
      if (held.get(name) === job) { held.delete(name); next(name); }
    });
  }
  return {
    request(name, options, work) {
      if (typeof options === 'function') { work = options; options = {}; }
      if (options.ifAvailable && (held.has(name) || queues.get(name)?.length)) return Promise.resolve().then(() => work(null));
      return new Promise((resolve,reject) => {
        const queue = queues.get(name) || []; queues.set(name, queue);
        queue.push({work, resolve, reject}); next(name);
      });
    }
  };
}
module.exports = { locks, turn };
