# subscribefix
修改Xboard订阅链接，为指定链接添加TLS 搭建在vercel.com 上
✅ Vercel 环境变量配置
REMOTE_BASE_URL：https://xxx.com/s/
NODES_TO_FIX：2,3,4

✅作用：
接收一个 URL，比如 https://xxx.cc.cd/s/7b1df63fb358103b9acf6b12557b8362
请求这个 URL 获取内容（通常是 Base64 编码的 VLESS 订阅）
解码 Base64
修改指定节点（比如节点2、3、4）的 security 参数为 tls
再 Base64 编码返回
