const { Pool, types } = require('pg');
types.setTypeParser(1082, v => v); // DATE -> 'YYYY-MM-DD' (ไม่แปลงเขตเวลา)
module.exports = new Pool();
