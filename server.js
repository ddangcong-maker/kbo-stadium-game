const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(__dirname));

const MAX_CHANNELS = 10;
const MAX_PER_CHANNEL = 100;
const players = new Map();
const teams = ['Eagles','Tigers','Giants','Bears','Twins','Lions','Landers','Wiz','Dinos','Heroes'];
const blocked = ['찢재명','재명','재판','멸공','윤어게인'];
const channels = Array.from({ length: MAX_CHANNELS }, (_, i) => `stadium-${i + 1}`);
const counts = () => Object.fromEntries(channels.map((c, i) => [String(i + 1), io.sockets.adapter.rooms.get(c)?.size || 0]));
function cleanMessage(value) {
  let s = String(value || '').trim().slice(0, 100);
  for (const word of blocked) s = s.split(word).join('****');
  return s;
}
function chooseChannel(requested) {
  if (requested && channels.includes(requested) && (io.sockets.adapter.rooms.get(requested)?.size || 0) < MAX_PER_CHANNEL) return requested;
  return channels.find(c => (io.sockets.adapter.rooms.get(c)?.size || 0) < MAX_PER_CHANNEL) || null;
}
function publicPlayer(p) { return { id:p.id, name:p.name, team:p.team, x:p.x, z:p.z, floor:p.floor, yaw:p.yaw, action:p.action }; }

io.on('connection', socket => {
  const channel = chooseChannel();
  if (!channel) { socket.emit('serverFull'); socket.disconnect(true); return; }
  const p = { id: socket.id, channel, name: '팬', team: teams[Math.floor(Math.random()*teams.length)], x: 0, z: 7, floor: 1, yaw: 0, action: 'walk' };
  players.set(socket.id, p);
  socket.join(channel);
  socket.emit('welcome', { id: socket.id, channel, channelNumber: channels.indexOf(channel)+1, players: [...players.values()].filter(v => v.channel === channel).map(publicPlayer), counts: counts(), maxPerChannel: MAX_PER_CHANNEL, maxChannels: MAX_CHANNELS });
  socket.to(channel).emit('joined', publicPlayer(p));
  io.emit('channelCounts', counts());

  socket.on('switchChannel', requested => {
    const current = players.get(socket.id); if (!current) return;
    const next = chooseChannel(String(requested || ''));
    if (!next) { socket.emit('channelError', '모든 채널이 가득 찼어.'); return; }
    if (next === current.channel) return;
    const old = current.channel;
    socket.to(old).emit('left', socket.id);
    socket.leave(old);
    current.channel = next; current.x = 0; current.z = 7; current.floor = 1; current.action = 'walk';
    socket.join(next);
    socket.emit('channelChanged', { channel: next, channelNumber: channels.indexOf(next)+1, players: [...players.values()].filter(v => v.channel === next && v.id !== socket.id).map(publicPlayer), counts: counts() });
    socket.to(next).emit('joined', publicPlayer(current));
    io.emit('channelCounts', counts());
  });
  socket.on('update', data => {
    const current = players.get(socket.id); if (!current || !data || typeof data !== 'object') return;
    for (const k of ['x','z','floor','yaw','action','name','team']) if (data[k] !== undefined) current[k] = data[k];
    socket.to(current.channel).emit('updated', publicPlayer(current));
  });
  socket.on('chat', raw => {
    const current = players.get(socket.id); if (!current) return;
    const message = cleanMessage(raw);
    if (!message) return;
    io.to(current.channel).emit('chat', { name: current.name || '팬', message });
  });
  socket.on('disconnect', () => {
    const current = players.get(socket.id);
    if (current) { socket.to(current.channel).emit('left', socket.id); players.delete(socket.id); io.emit('channelCounts', counts()); }
  });
});

app.get('/health', (_req, res) => res.json({ ok:true, maxChannels:MAX_CHANNELS, maxPerChannel:MAX_PER_CHANNEL, counts:counts() }));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Stadium MVP running on port ${PORT}`));
