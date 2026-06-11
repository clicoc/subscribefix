import fetch from "node-fetch";
import yaml from "js-yaml";

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

    // 获取客户端 User-Agent
    const userAgent = (req.headers["user-agent"] || "").toLowerCase();
    
    // ⭐ 改进 1：增加对 flag=meta 的识别，方便在浏览器直接加参数测试
    const isClashRequest = userAgent.includes("clash") || userAgent.includes("mihomo") || req.url.includes("flag=clash") || req.url.includes("flag=meta");

    // 强制向源站请求 flag=meta 以获取完整的 VLESS 节点信息
    const remoteUrl = isClashRequest 
      ? `${REMOTE_BASE_URL}${subId}?flag=meta` 
      : `${REMOTE_BASE_URL}${subId}`;

    const response = await fetch(remoteUrl);
    if (!response.ok) return res.status(500).send("Failed to fetch remote subscription");

    // 获取 subscription-userinfo (流量信息)
    const subUserInfo = response.headers.get("subscription-userinfo");

    // ==========================================
    // 处理 Clash (Meta) 客户端请求 (YAML)
    // ==========================================
    if (isClashRequest) {
      const yamlText = await response.text();
      let config;
      try {
        config = yaml.load(yamlText);
      } catch (e) {
        return res.status(500).send("Failed to parse YAML from remote");
      }

      // 遍历所有节点进行修改
      if (config && config.proxies && Array.isArray(config.proxies)) {
        config.proxies.forEach(proxy => {
          if (proxy.name && typeof proxy.name === "string") {
            
            // ⭐ 改进 2：使用正则进行精准匹配边界。防止匹配 "2" 时误伤 "12" 或 "24"
            const needFix = nodesToFix.some(num => {
               // \D 代表非数字。这意味着数字必须前后没有其他数字（例如 "美国2" 符合要求）
               const regex = new RegExp(`(^|\\D)${num}($|\\D)`);
               return regex.test(proxy.name);
            });
            
            if (needFix && proxy.type === "vless") {
              proxy.tls = true; // 修改为 tls 开启
              
              // ⭐ 改进 3：自动提取 ws-opts 中的 Host 作为 TLS 的 SNI(servername)
              if (proxy["ws-opts"] && proxy["ws-opts"].headers && proxy["ws-opts"].headers.Host) {
                proxy.servername = proxy["ws-opts"].headers.Host;
              }

              // ⭐ 改进 4：添加指纹以提高 TLS 伪装的稳定性（Meta 内核推荐）
              proxy["client-fingerprint"] = "chrome";
            }
          }
        });
      }

      const fixedYamlText = yaml.dump(config);

      res.setHeader("Content-Type", "text/yaml;charset=utf-8");
      res.setHeader("profile-update-interval", "24"); 

      // 透传 header
      if (subUserInfo) {
        res.setHeader("subscription-userinfo", subUserInfo);
        res.setHeader("Subscription-Userinfo", subUserInfo);
      }

      return res.status(200).send(fixedYamlText);
    } 
    
    // ==========================================
    // 处理传统客户端请求 (V2rayN - Base64) 
    // ==========================================
    else {
      const remoteSubBase64 = (await response.text()).trim();
      const decoded = Buffer.from(remoteSubBase64, "base64").toString("utf-8");

      const fixedLines = decoded.split("\n").map(line => {
        const hashIndex = line.indexOf("#");
        if (hashIndex !== -1) {
          const hashPart = decodeURIComponent(line.slice(hashIndex + 1));

          // Base64 模式下也同步更新为精确匹配逻辑
          const needFix = nodesToFix.some(num => {
             const regex = new RegExp(`(^|\\D)${num}($|\\D)`);
             return regex.test(hashPart);
          });

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
