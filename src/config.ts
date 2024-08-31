import * as fs from 'fs';
import * as path from 'path';

const configPath = path.resolve(__dirname, '../db_connection.json');

const rawConfig = fs.readFileSync(configPath, 'utf-8');
const dbConfig = JSON.parse(rawConfig);

export default dbConfig;