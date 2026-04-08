import fetch from 'node-fetch';

export default async function handler(req, res) {
  try {
    const subId = req.url.split('/')[1];
    if (!subId) {
      res.status(400).send('Missing subscription id in path');
      return;
    }

    const remoteUrl = `https://qianyue.cc.cd/s/${subId}`;
    const response = await fetch(remoteUrl);
    if (!response.ok) {
      res.status(500).send('Failed to fetch remote subscription');
      return;
    }

    const remoteSubBase64 = (await response.text()).trim();

    // Base64 解码
    let decoded;
    try {
      decoded = Buffer.from(remoteSubBase64, 'base64').toString('utf-8');
    } catch {
      res.status(400).send('Failed to decode Base64 content from remote subscription');
      return;
    }

    // 修改节点 security
    const nodesToFix = ['节点2', '节点3', '节点4'];
    const lines = decoded.split('\n');
    const fixedLines = lines.map(line => {
      for (const node of nodesToFix) {
        if (line.includes(node)) {
          if (line.includes('security=')) {
            line = line.replace(/security=[^&]*/, 'security=tls');
          } else if (line.includes('?')) {
            line += '&security=tls';
          } else {
            line += '?security=tls';
          }
        }
      }
      return line;
    });

    const fixedSub = fixedLines.join('\n');
    const fixedSubBase64 = Buffer.from(fixedSub, 'utf-8').toString('base64');

    res.setHeader('Content-Type', 'text/plain;charset=utf-8');
    res.status(200).send(fixedSubBase64);

  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
}
