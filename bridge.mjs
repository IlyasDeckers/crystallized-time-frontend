import OSC from 'osc-js'

// Defaults match the frontend (ws://localhost:8080) and the Rust config in
// crystallized_time's [osc] section (UDP 9000 inbound, 9001 outbound).
const config = {
    udpClient: { host: '127.0.0.1', port: 9000 }, // browser -> rust
    udpServer: { host: '127.0.0.1', port: 9001 }, // rust    -> browser
    wsServer:  { host: 'localhost', port: 8080 },
}

const osc = new OSC({ plugin: new OSC.BridgePlugin(config) })
osc.open()

console.log(`osc bridge:
  ws://${config.wsServer.host}:${config.wsServer.port}  <-> ` +
    `udp://${config.udpClient.host}:${config.udpClient.port} (out) / ` +
    `:${config.udpServer.port} (in)`)