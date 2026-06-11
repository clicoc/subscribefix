import fetch from "node-fetch";
import yaml from "js-yaml";

const REMOTE_BASE_URL = process.env.REMOTE_BASE_URL;
const NODES_TO_FIX = process.env.NODES_TO_FIX;

if (!REMOTE_BASE_URL) throw new Error("Please set REMOTE_BASE_URL");
if (!NODES_TO_FIX) throw new Error("Please set NODES_TO_FIX (comma separated)");

const nodesToFix = NODES_TO_FIX.split(",").map(s => s.trim());

// 核心正则：匹配独立数字
const isTargetNode = (name) => nodesToFix.some(num => new RegExp(`(^|\\D)${num}($|\\D)`).test(name));

export default async function handler(req, res) {
  try {
    // 匹配订阅 ID
    const match = req.url.match(/\/s\/([a-zA-Z0-9]+)/);
    if (!match) return res.status(400).send("Missing subscription id");
    const subId = match[1];

    // 获取并解析参数与 UA
    const userAgent = (req.headers["user-agent"] || "").toLowerCase();
    
    // 提取 URL 中的 flag 参数 (兼容 Vercel 的 req.url)
    let flagParam = "";
    if (req.url.includes("?")) {
        const searchParams = new URLSearchParams(req.url.substring(req.url.indexOf("?")));
        flagParam = searchParams.get("flag") || "";
    }

    // 智能推断客户端类型 (Flag 优先，UA 兜底)
    let targetClient = "base64"; // 默认 v2rayN
    const identifiers = flagParam + " " + userAgent;

    if (identifiers.includes("sing-box")) targetClient = "sing-box";
    else if (identifiers.includes("stash")) targetClient = "stash";
    else if (identifiers.includes("surge")) targetClient = "surge";
    else if (identifiers.includes("surfboard")) targetClient = "surfboard";
    else if (identifiers.includes("meta") || identifiers.includes("mihomo") || identifiers.includes("clash")) {
        targetClient = "meta";
    }

    // 强制向源站请求对应的格式 (如果不带 flag，Xboard 可能默认输出 base64)
    const remoteUrl = targetClient !== "base64" 
      ? `${REMOTE_BASE_URL}${subId}?flag=${targetClient}` 
      : `${REMOTE_BASE_URL}${subId}`;

    const response = await fetch(remoteUrl);
    if (!response.ok) return res.status(500).send(`Failed to fetch remote: ${response.statusText}`);

    const subUserInfo = response.headers.get("subscription-userinfo");
    const rawText = await response.text();

    // 设置通用的响应头
    if (subUserInfo) {
      res.setHeader("subscription-userinfo", subUserInfo);
      res.setHeader("Subscription-Userinfo", subUserInfo);
    }

    // ==========================================
    // 1. 处理 YAML 族 (Clash, Meta, Stash)
    // ==========================================
    if (["clash", "meta", "stash"].includes(targetClient)) {
      let config = yaml.load(rawText);
      
      if (config && config.proxies && Array.isArray(config.proxies)) {
        config.proxies.forEach(proxy => {
          if (proxy.name && proxy.type === "vless" && isTargetNode(proxy.name)) {
            proxy.tls = true;
            // 提取 SNI
            if (proxy["ws-opts"]?.headers?.Host) {
              proxy.servername = proxy["ws-opts"].headers.Host;
            }
            // 针对 Meta/Stash 优化
            if (targetClient === "meta" || targetClient === "stash") {
                proxy.alpn = ["http/1.1"];
            }
          }
        });
      }
      res.setHeader("Content-Type", "text/yaml;charset=utf-8");
      res.setHeader("profile-update-interval", "24"); 
      return res.status(200).send(yaml.dump(config));
    }

    // ==========================================
    // 2. 处理 JSON 族 (Sing-box)
    // ==========================================
    else if (targetClient === "sing-box") {
      let config = JSON.parse(rawText);
      
      // Sing-box 的节点在 outbounds 数组中，且名字字段叫 tag
      if (config && config.outbounds && Array.isArray(config.outbounds)) {
        config.outbounds.forEach(outbound => {
          if (outbound.tag && outbound.type === "vless" && isTargetNode(outbound.tag)) {
            // Sing-box 的 tls 配置是一个对象
            if (!outbound.tls) outbound.tls = {};
            outbound.tls.enabled = true;
            
            // 提取 SNI
            if (outbound.transport?.type === "ws" && outbound.transport?.headers?.Host) {
               outbound.tls.server_name = outbound.transport.headers.Host;
            }
          }
        });
      }
      res.setHeader("Content-Type", "application/json;charset=utf-8");
      return res.status(200).send(JSON.stringify(config, null, 2));
    }

    // ==========================================
    // 3. 处理 CONF 文本族 (Surge, Surfboard)
    // ==========================================
    else if (["surge", "surfboard"].includes(targetClient)) {
      const lines = rawText.split("\n");
      const fixedLines = lines.map(line => {
        // Surge/Surfboard 节点格式通常为：节点名 = vless, server, port, ...
        const equalIndex = line.indexOf('=');
        if (equalIndex > 0) {
          const nodeName = line.substring(0, equalIndex).trim();
          
          if (isTargetNode(nodeName) && line.toLowerCase().includes('vless')) {
            // 修改 tls 参数
            if (!line.includes('tls=')) {
                line += ', tls=true';
            } else {
                line = line.replace(/tls=false/gi, 'tls=true');
            }
            // 提取 Host 补齐 sni 参数
            if (!line.includes('sni=')) {
                const hostMatch = line.match(/Host:\s*([^,\}]+)/i);
                if (hostMatch) {
                    line += `, sni=${hostMatch[1].trim()}`;
                }
            }
          }
        }
        return line;
      });
      res.setHeader("Content-Type", "text/plain;charset=utf-8");
      return res.status(200).send(fixedLines.join("\n"));
    }

    // ==========================================
    // 4. 处理 Base64 族 (传统 v2rayN)
    // ==========================================
    else {
      const decoded = Buffer.from(rawText.trim(), "base64").toString("utf-8");
      const fixedLines = decoded.split("\n").map(line => {
        const hashIndex = line.indexOf("#");
        if (hashIndex !== -1) {
          const hashPart = decodeURIComponent(line.slice(hashIndex + 1));
          if (isTargetNode(hashPart)) {
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
      return res.status(200).send(fixedSubBase64);
    }

  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
}
