// Startup file untuk hosting (cPanel "Setup Node.js App" / hPanel "Node.js" / Passenger).
// Selalu menjalankan server, juga saat dimuat oleh loader hosting.
const app = require('./server');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sistem Request Cetak Sticker berjalan di port ${PORT}`));
