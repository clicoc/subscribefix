import fetch from "node-fetch";

// REMOTE_BASE_URL 和 NODES_TO_FIX 都从环境变量获取,比如NODES_TO_FIX 值 2,3,4   REMOTE_BASE_URL 值 https://xxx.cc.cd/s/
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

    // 👇 请求源站（增加 UA 提高兼容性）
    const response = await fetch(remoteUrl, {
      headers: {
        "User-Agent": "ClashMeta",
        "Accept": "*/*"
      }
    });

    if (!response.ok) return res.status(500).send("Failed to fetch remote subscription");

    // ✅ 读取源站 Header（关键）
    const subscriptionUserinfo = response.headers.get("subscription-userinfo");
    const contentType = response.headers.get("content-type");
    const profileUpdateInterval = response.headers.get("profile-update-interval");
    const contentDisposition = response.headers.get("content-disposition");

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

    // ✅ ===== Header 透传开始 =====

    // 核心流量信息（最重要）
    if (subscriptionUserinfo) {
      res.setHeader("subscription-userinfo", subscriptionUserinfo);
      // 兼容部分客户端大小写
      res.setHeader("Subscription-Userinfo", subscriptionUserinfo);
    }

    // 客户端更新间隔（有些机场会用）
    if (profileUpdateInterval) {
      res.setHeader("profile-update-interval", profileUpdateInterval);
    } else {
      res.setHeader("profile-update-interval", "6");
    }

    // 文件下载名称（可选）
    if (contentDisposition) {
      res.setHeader("content-disposition", contentDisposition);
    }

    // content-type 保留
    if (contentType) {
      res.setHeader("content-type", contentType);
    } else {
      res.setHeader("Content-Type", "text/plain;charset=utf-8");
    }

    // 禁止缓存（避免订阅不更新）
    res.setHeader("Cache-Control", "no-cache");

    // ✅ ===== Header 透传结束 =====

    res.status(200).send(fixedSubBase64);

  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
}
