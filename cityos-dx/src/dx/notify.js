// Notification service (BIS 4.3 change notices, 5.6 "notify later"). Notices are stored first and
// delivered when the recipient reads their inbox; while the service is paused they stay queued.
import { q, sharedSwitch } from '../db.js';
import { iso } from '../util.js';

export function makeNotify(db, audit) {
  const state = sharedSwitch(db, 'notification');
  return {
    state,
    push(recipient, msg) {
      if (!recipient) return;
      q.run(db, 'INSERT INTO notices (recipient, msg, created_at, delivered) VALUES (?,?,?,0)', recipient, msg, iso(Date.now()));
    },
    // Returns undelivered notices and marks them delivered. While paused, nothing is handed out (BIS 5.6 failure case).
    inbox(recipient) {
      if (!state.up) return { available: false, notices: [], queued: q.get(db, 'SELECT COUNT(*) n FROM notices WHERE recipient=? AND delivered=0', recipient).n };
      const rows = q.all(db, 'SELECT id, msg, created_at FROM notices WHERE recipient=? AND delivered=0 ORDER BY id', recipient);
      if (rows.length) q.run(db, 'UPDATE notices SET delivered=1 WHERE recipient=? AND delivered=0 AND id<=?', recipient, rows.at(-1).id);
      return { available: true, notices: rows };
    },
    history: recipient => q.all(db, 'SELECT id, msg, created_at, delivered FROM notices WHERE recipient=? ORDER BY id DESC LIMIT 200', recipient),
    setUp(up, by) { state.up = !!up; audit.log('Operations', by, up ? 'Notification service resumed' : 'Notification service paused', ''); },
    // Watches (BIS 4.3: apps register to be told about meta-data changes)
    watch(consumer, itemId) { q.run(db, 'INSERT OR IGNORE INTO watches (consumer, item_id) VALUES (?,?)', consumer, itemId); },
    unwatch(consumer, itemId) { q.run(db, 'DELETE FROM watches WHERE consumer=? AND item_id=?', consumer, itemId); },
    changed(itemId, what) {
      for (const w of q.all(db, 'SELECT consumer FROM watches WHERE item_id=?', itemId)) this.push(w.consumer, `Catalogue item ${itemId} ${what}`);
    },
  };
}
