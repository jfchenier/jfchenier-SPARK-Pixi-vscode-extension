import * as assert from 'assert';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import proxyquire = require('proxyquire');
import { downloadFile } from '../../pixi';
import * as os from 'os';

function emulateResponse(cb: any, statusCode: number, headers: any = {}) {
    const res = new EventEmitter();
    (res as any).statusCode = statusCode;
    (res as any).headers = headers;
    (res as any).pipe = (dest: any) => {
        dest.emit('finish'); // Immediate finish for simplicity
        return dest;
    };
    cb(res);
    return new EventEmitter(); // Return Request object
}

suite('Download Logic Test Suite', () => {
    let server: http.Server;
    let port: number;
    const tempDir = os.tmpdir();
    const destFile = path.join(tempDir, 'download_test_file.txt');

    setup((done) => {
        // Start a local server that redirects
        server = http.createServer((req, res) => {
            if (req.url === '/redirect') {
                res.writeHead(302, { 'Location': `http://localhost:${port}/final` });
                res.end();
            } else if (req.url === '/final') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Hello World');
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        server.listen(0, () => {
            const addr = server.address();
            if (addr && typeof addr !== 'string') {
                port = addr.port;
                done();
            }
        });
    });

    teardown((done) => {
        server.close(done);
        if (fs.existsSync(destFile)) {
            fs.unlinkSync(destFile);
        }
    });

    test('Follows redirects and downloads file', async () => {
        const url = `http://localhost:${port}/redirect`;
        await downloadFile(url, destFile);

        const content = fs.readFileSync(destFile, 'utf-8');
        assert.strictEqual(content, 'Hello World');
    });

    test('Retries on 504 error and eventually succeeds', async () => {
        const callTracker = { count: 0 };
        const mockHttps = {
            get: (url: any, cb: any) => {
                callTracker.count++;
                if (callTracker.count < 2) {
                    // Fail first time
                    const res = new EventEmitter();
                    (res as any).statusCode = 504;
                    cb(res);
                    return new EventEmitter();
                } else {
                    // Succeed second time
                    return emulateResponse(cb, 200);
                }
            }
        };

        const downloadFile = proxyquire('../../pixi', {
            'https': mockHttps,
            'fs': {
                createWriteStream: () => {
                    const stream = new EventEmitter();
                    (stream as any).close = () => { };
                    setTimeout(() => stream.emit('finish'), 10);
                    return stream;
                },
                unlink: () => { }
            }
        }).downloadFile;

        await downloadFile('https://example.com/file', '/dev/null');
        assert.strictEqual(callTracker.count, 2, 'Should have retried');
    });
});
