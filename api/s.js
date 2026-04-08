import fetch from "node-fetch";

// REMOTE_BASE_URL 和 NODES_TO_FIX 都从环境变量获取
const REMOTE_BASE_URL = process.env.REMOTE_BASE_URL;
const NODES_TO_FIX = process.env.NODES_TO_FIX;

if (!REMOTE_BASE_URL) {
  throw new Error("Please set REMOTE_BASE_URL in environment variables");
}

if (!NODES_TO_FIX) {
  throw new Error("Please set NODES_TO_FIX in environment variables (comma separated)");
}

// 转成数组
const nodesToFix = NODES_TO_FIX.split(",").map(s => s.trim());

export default async function handler(req, res) {
  try {
    // 匹配 /s/:subId
    const match = req.url.match(/\/s\/([a-zA-Z0-9]+)/);
    if (!match) return res.status(400).send("Missing subscription id");
    const subId = match[1];

    const remoteUrl = `${REMOTE_BASE_URL}${subId}`;
    const response = await fetch(remoteUrl);
    if (!response.ok) return res.status(500).send("Failed to fetch remote subscription");

    // ⭐ 获取 subscription-userinfo
    const subUserInfo = response.headers.get("subscription-userinfo");

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

    // ⭐ 透传 header（关键）
    if (subUserInfo) {
      res.setHeader("subscription-userinfo", subUserInfo);
      res.setHeader("Subscription-Userinfo", subUserInfo); // 兼容客户端
    }

    res.status(200).send(fixedSubBase64);

  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
}
