import fetch from "node-fetch";
import yaml from "js-yaml"; // 新增引入 YAML 解析库

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

    // 获取客户端 User-Agent，判断是否为 Clash
    const userAgent = (req.headers["user-agent"] || "").toLowerCase();
    const isClashRequest = userAgent.includes("clash") || userAgent.includes("mihomo") || req.url.includes("flag=clash");

    // 根据客户端类型，决定向源站请求时的链接参数
    const remoteUrl = isClashRequest 
      ? `${REMOTE_BASE_URL}${subId}?flag=meta` 
      : `${REMOTE_BASE_URL}${subId}`;

    const response = await fetch(remoteUrl);
    if (!response.ok) return res.status(500).send("Failed to fetch remote subscription");

    // ⭐ 获取 subscription-userinfo (流量信息)
    const subUserInfo = response.headers.get("subscription-userinfo");

    // ==========================================
    // 处理 Clash 客户端请求 (YAML)
    // ==========================================
    if (isClashRequest) {
      const yamlText = await response.text();
      let config;
      try {
        config = yaml.load(yamlText);
      } catch (e) {
        return res.status(500).send("Failed to parse YAML from remote");
      }

      // 遍历所有节点
      if (config && config.proxies && Array.isArray(config.proxies)) {
        config.proxies.forEach(proxy => {
          // Clash 中节点的名称在 proxy.name 中
          if (proxy.name && typeof proxy.name === "string") {
            // 判断 proxy.name 中是否包含 nodesToFix 中的数字
            const needFix = nodesToFix.some(num => proxy.name.includes(num));
            
            if (needFix && proxy.type === "vless") {
              proxy.tls = true; // 修改为 tls 开启
              // proxy['skip-cert-verify'] = true; // 如果之后还报证书错，可以解开这行
            }
          }
        });
      }

      const fixedYamlText = yaml.dump(config);

      res.setHeader("Content-Type", "text/yaml;charset=utf-8");
      res.setHeader("profile-update-interval", "24"); // 告诉 Clash 每 24 小时自动更新

      // 透传 header
      if (subUserInfo) {
        res.setHeader("subscription-userinfo", subUserInfo);
        res.setHeader("Subscription-Userinfo", subUserInfo);
      }

      return res.status(200).send(fixedYamlText);
    } 
    
    // ==========================================
    // 处理传统客户端请求 (V2rayN - Base64) - 你的原版逻辑
    // ==========================================
    else {
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

      // 透传 header
      if (subUserInfo) {
        res.setHeader("subscription-userinfo", subUserInfo);
        res.setHeader("Subscription-Userinfo", subUserInfo); 
      }

      return res.status(200).send(fixedSubBase64);
    }

  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
}
