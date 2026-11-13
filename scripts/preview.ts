import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createStaticServer } from './lib/static-server.ts';

const directory = resolve(process.argv[2] || 'dist');
if (!existsSync(join(directory, 'index.html'))) throw new Error('Run npm run build first.');
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
createStaticServer(directory).listen(port, host, () => {
  console.log(`Static site: http://${host}:${port}\nServing only ${directory}`);
});
