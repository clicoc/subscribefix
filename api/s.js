import fetch from "node-fetch";

const REMOTE_BASE_URL = process.env.REMOTE_BASE_URL || "https://qianyue.cc.cd/s/";

// 只要 # 后的内容包含这些数字，就修改 security
const nodesToFix = ["2", "3", "4", "5", "6", "7", "10"];

export default async function handler(req, res) {
  try {
    // 提取 subId
    const match = req.url.match(/\/s\/([a-zA-Z0-9]+)/);
    if (!match) return res.status(400).send("Missing subscription id");
    const subId = match[1];

    const remoteUrl = `${REMOTE_BASE_URL}${subId}`;
    const response = await fetch(remoteUrl);
    if (!response.ok) return res.status(500).send("Failed to fetch remote subscription");

    const remoteSubBase64 = (await response.text()).trim();
    const decoded = Buffer.from(remoteSubBase64, "base64").toString("utf-8");

    const fixedLines = decoded.split("\n").map(line => {
      const hashIndex = line.indexOf("#");
      if (hashIndex !== -1) {
        const hashPart = decodeURIComponent(line.slice(hashIndex + 1));

        // 判断 hash 中是否包含 nodesToFix 中的数字
        const needFix = nodesToFix.some(num => hashPart.includes(num));
        if (needFix) {
          if (line.includes("security=")) {
            line = line.replace(/security=[^&]*/, "security=tls");
          } else if (line.includes("?")) {
            line += "&security=tls";
          } else {
            line += "?security=tls";
          }
        }
      }
      return line;
    });

    const fixedSubBase64 = Buffer.from(fixedLines.join("\n"), "utf-8").toString("base64");
    res.setHeader("Content-Type", "text/plain;charset=utf-8");
    res.status(200).send(fixedSubBase64);

  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
}
