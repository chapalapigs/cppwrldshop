require("dotenv").config();

const { sendTelegramMessage } = require("./telegram");

sendTelegramMessage(
    "🤖 <b>CPP WRLD</b>\n\nTelegram conectado correctamente. ✅"
);