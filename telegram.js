const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token) {
    console.error("Falta TELEGRAM_BOT_TOKEN en .env");
    process.exit(1);
}

if (!chatId) {
    console.error("Falta TELEGRAM_CHAT_ID en .env");
    process.exit(1);
}

async function sendTelegramMessage(message) {
    const url =
        `https://api.telegram.org/bot${token}/sendMessage`;

    const response = await fetch(url, {
        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: "HTML"
        })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
        throw new Error(
            data.description || "Telegram rechazó el mensaje."
        );
    }

    console.log("Mensaje enviado a Telegram ✅");

    return data;
}

module.exports = {
    sendTelegramMessage
};