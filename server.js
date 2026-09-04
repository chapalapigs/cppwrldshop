require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { sendTelegramMessage } = require("./telegram");

const app = express();

// Render está detrás de un proxy
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;

// ==============================
// VARIABLES DE ENTORNO
// ==============================

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;

const STORE_URL =
    process.env.STORE_URL ||
    "https://cppwrldshop.onrender.com";

const MP_NOTIFICATION_URL =
    process.env.MP_NOTIFICATION_URL ||
    `${STORE_URL}/api/webhook/mercadopago`;

const ORDERS_FILE = path.join(
    __dirname,
    "orders.json"
);

// ==============================
// PRODUCTOS
// ==============================

const PRODUCTS = {
    test: {
        id: "test",
        title: "TEST",
        price: 25
    }
};

// ==============================
// MIDDLEWARE
// ==============================

app.use(express.json());
app.use(express.static(__dirname));

// ==============================
// RATE LIMIT
// ==============================

const checkoutLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false
});

const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
});

// ==============================
// HELPERS
// ==============================

function cleanText(value, maxLength = 500) {
    return String(value ?? "")
        .trim()
        .slice(0, maxLength);
}

function createOrderId() {
    return (
        "CPP-" +
        Date.now() +
        "-" +
        crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase()
    );
}

function cleanCustomer(customer = {}) {
    return {
        firstName: cleanText(
            customer.firstName,
            100
        ),

        lastName: cleanText(
            customer.lastName,
            100
        ),

        email: cleanText(
            customer.email,
            200
        ),

        phone: cleanText(
            customer.phone,
            50
        ),

        address: cleanText(
            customer.address,
            300
        ),

        city: cleanText(
            customer.city,
            100
        ),

        state: cleanText(
            customer.state,
            100
        ),

        postalCode: cleanText(
            customer.postalCode,
            20
        ),

        notes: cleanText(
            customer.notes,
            500
        )
    };
}

function validateItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error(
            "El carrito está vacío."
        );
    }

    return items.map(item => {
        const product =
            PRODUCTS[item.id];

        if (!product) {
            throw new Error(
                `Producto inválido: ${item.id}`
            );
        }

        const quantity =
            Number(item.quantity);

        if (
            !Number.isInteger(quantity) ||
            quantity < 1 ||
            quantity > 20
        ) {
            throw new Error(
                "Cantidad de producto inválida."
            );
        }

        return {
            id: product.id,
            title: product.title,
            quantity,
            unit_price: product.price
        };
    });
}

function readOrders() {
    try {
        if (!fs.existsSync(ORDERS_FILE)) {
            return [];
        }

        const data =
            fs.readFileSync(
                ORDERS_FILE,
                "utf8"
            );

        if (!data.trim()) {
            return [];
        }

        const parsed =
            JSON.parse(data);

        return Array.isArray(parsed)
            ? parsed
            : [];
    } catch (error) {
        console.error(
            "Error leyendo orders.json:",
            error
        );

        return [];
    }
}

function writeOrders(orders) {
    fs.writeFileSync(
        ORDERS_FILE,
        JSON.stringify(
            orders,
            null,
            2
        ),
        "utf8"
    );
}

// ==============================
// TELEGRAM
// ==============================

function escapeTelegram(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

async function sendSaleTelegram(
    order,
    payment
) {
    const productLines =
        order.items
            .map(item => {
                const subtotal =
                    item.unit_price *
                    item.quantity;

                return (
                    `📦 ${escapeTelegram(item.title)} ` +
                    `×${item.quantity} — ` +
                    `$${subtotal} MXN`
                );
            })
            .join("\n");

    const message = `
🛍️ <b>NUEVA VENTA — CPP WRLD SHOP</b>

🧾 <b>Pedido:</b>
#${escapeTelegram(order.id)}

✅ <b>PAGO APROBADO</b>

${productLines}

💰 <b>Total:</b>
$${order.total} MXN

👤 <b>Cliente:</b>
${escapeTelegram(order.customer.firstName)} ${escapeTelegram(order.customer.lastName)}

📧 ${escapeTelegram(order.customer.email)}

📱 ${escapeTelegram(order.customer.phone)}

📍 <b>Dirección de envío:</b>
${escapeTelegram(order.customer.address)}

🏙️ ${escapeTelegram(order.customer.city)}

🗺️ ${escapeTelegram(order.customer.state)}

📮 C.P. ${escapeTelegram(order.customer.postalCode)}

📝 <b>Notas:</b>
${escapeTelegram(
    order.customer.notes ||
    "Sin notas"
)}

💳 <b>ID de pago:</b>
${escapeTelegram(payment.id)}

💳 <b>Estado:</b>
${escapeTelegram(payment.status)}

🐷 <b>CPP WRLD SHOP</b>
`;

    await sendTelegramMessage(
        message
    );
}

// ==============================
// MERCADO PAGO
// ==============================

async function getMercadoPagoPayment(
    paymentId
) {
    if (!MP_ACCESS_TOKEN) {
        throw new Error(
            "Falta MP_ACCESS_TOKEN."
        );
    }

    const response =
        await fetch(
            `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
            {
                method: "GET",

                headers: {
                    Authorization:
                        `Bearer ${MP_ACCESS_TOKEN}`
                }
            }
        );

    const data =
        await response.json();

    if (!response.ok) {
        throw new Error(
            data.message ||
            "No se pudo obtener el pago."
        );
    }

    return data;
}

// ==============================
// CREAR CHECKOUT
// ==============================

app.post(
    "/api/create-preference",
    checkoutLimiter,
    async (req, res) => {
        try {
            if (!MP_ACCESS_TOKEN) {
                return res.status(500).json({
                    error:
                        "Mercado Pago no está configurado."
                });
            }

            const {
                items,
                customer
            } = req.body || {};

            const cleanItems =
                validateItems(items);

            const cleanCustomerData =
                cleanCustomer(customer);

            if (
                !cleanCustomerData.firstName ||
                !cleanCustomerData.lastName ||
                !cleanCustomerData.email ||
                !cleanCustomerData.phone ||
                !cleanCustomerData.address ||
                !cleanCustomerData.city ||
                !cleanCustomerData.state ||
                !cleanCustomerData.postalCode
            ) {
                return res.status(400).json({
                    error:
                        "Faltan datos del cliente."
                });
            }

            const total =
                cleanItems.reduce(
                    (sum, item) =>
                        sum +
                        item.unit_price *
                        item.quantity,
                    0
                );

            const orderId =
                createOrderId();

            const order = {
                id: orderId,

                status: "pending",

                paymentStatus: "pending",

                paymentId: null,

                createdAt:
                    new Date().toISOString(),

                paidAt: null,

                customer:
                    cleanCustomerData,

                items:
                    cleanItems,

                total
            };

            const orders =
                readOrders();

            orders.push(order);

            writeOrders(orders);

            const preference = {
                items:
                    cleanItems.map(
                        item => ({
                            id: item.id,

                            title:
                                item.title,

                            quantity:
                                item.quantity,

                            currency_id:
                                "MXN",

                            unit_price:
                                item.unit_price
                        })
                    ),

                external_reference:
                    orderId,

                notification_url:
                    MP_NOTIFICATION_URL,

                back_urls: {
                    success:
                        STORE_URL,

                    failure:
                        STORE_URL,

                    pending:
                        STORE_URL
                },

                auto_return:
                    "approved"
            };

            console.log(
                "Creando preferencia:",
                orderId
            );

            const response =
                await fetch(
                    "https://api.mercadopago.com/checkout/preferences",
                    {
                        method: "POST",

                        headers: {
                            Authorization:
                                `Bearer ${MP_ACCESS_TOKEN}`,

                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify(
                                preference
                            )
                    }
                );

            const data =
                await response.json();

            if (!response.ok) {
                console.error(
                    "Mercado Pago rechazó la preferencia:",
                    data
                );

                return res.status(
                    500
                ).json({
                    error:
                        data.message ||
                        "No se pudo crear el pago."
                });
            }

            console.log(
                "Preferencia creada:",
                orderId
            );

            return res.json({
                init_point:
                    data.init_point,

                orderId
            });

        } catch (error) {
            console.error(
                "Error creando preferencia:",
                error
            );

            return res.status(500).json({
                error:
                    error.message ||
                    "Error interno."
            });
        }
    }
);

// ==============================
// WEBHOOK MERCADO PAGO
// ==============================

app.post(
    "/api/webhook/mercadopago",
    webhookLimiter,
    async (req, res) => {
        try {
            const xSignature =
                req.headers[
                    "x-signature"
                ];

            const xRequestId =
                req.headers[
                    "x-request-id"
                ];

            const dataId =
                req.query["data.id"] ||
                req.query.data_id ||
                "";

            console.log(
                "Webhook recibido.",
                {
                    dataId,
                    hasSignature:
                        !!xSignature,
                    hasRequestId:
                        !!xRequestId
                }
            );

            if (!xSignature) {
                console.error(
                    "Webhook sin x-signature."
                );

                return res.sendStatus(
                    401
                );
            }

            if (!xRequestId) {
                console.error(
                    "Webhook sin x-request-id."
                );

                return res.sendStatus(
                    401
                );
            }

            if (!MP_WEBHOOK_SECRET) {
                console.error(
                    "Falta MP_WEBHOOK_SECRET."
                );

                return res.sendStatus(
                    500
                );
            }

            // ==============================
            // PARSEAR X-SIGNATURE
            // ==============================

            const parts =
                xSignature.split(",");

            let ts = null;
            let receivedHash = null;

            for (
                const part of parts
            ) {
                const [
                    key,
                    ...valueParts
                ] =
                    part.split("=");

                const value =
                    valueParts.join("=");

                if (
                    !key ||
                    !value
                ) {
                    continue;
                }

                const trimmedKey =
                    key.trim();

                const trimmedValue =
                    value.trim();

                if (
                    trimmedKey ===
                    "ts"
                ) {
                    ts =
                        trimmedValue;
                }

                if (
                    trimmedKey ===
                    "v1"
                ) {
                    receivedHash =
                        trimmedValue;
                }
            }

            if (
                !ts ||
                !receivedHash
            ) {
                console.error(
                    "x-signature incompleta."
                );

                return res.sendStatus(
                    401
                );
            }

            // ==============================
            // CREAR MANIFEST
            // ==============================

            const manifest =
                `id:${dataId};request-id:${xRequestId};ts:${ts};`;

            console.log(
                "Manifest generado:",
                manifest
            );

            // ==============================
            // GENERAR FIRMA
            // ==============================

            const expectedHash =
                crypto
                    .createHmac(
                        "sha256",
                        MP_WEBHOOK_SECRET
                    )
                    .update(
                        manifest
                    )
                    .digest("hex");

            const receivedBuffer =
                Buffer.from(
                    receivedHash,
                    "utf8"
                );

            const expectedBuffer =
                Buffer.from(
                    expectedHash,
                    "utf8"
                );

            if (
                receivedBuffer.length !==
                expectedBuffer.length
            ) {
                console.error(
                    "Webhook rechazado: longitud de firma diferente."
                );

                return res.sendStatus(
                    401
                );
            }

            if (
                !crypto.timingSafeEqual(
                    receivedBuffer,
                    expectedBuffer
                )
            ) {
                console.error(
                    "Webhook rechazado: firma inválida."
                );

                return res.sendStatus(
                    401
                );
            }

            console.log(
                "Webhook Mercado Pago verificado ✅"
            );

            // ==============================
            // PAYMENT ID
            // ==============================

            const paymentId =
                dataId;

            if (!paymentId) {
                console.error(
                    "Webhook sin data.id."
                );

                return res.sendStatus(
                    400
                );
            }

            // ==============================
            // OBTENER PAGO
            // ==============================

            const payment =
                await getMercadoPagoPayment(
                    paymentId
                );

            console.log(
                "Pago recibido:",
                payment.id,
                payment.status
            );

            // ==============================
            // ORDER ID
            // ==============================

            const orderId =
                payment.external_reference;

            if (!orderId) {
                console.error(
                    "El pago no tiene external_reference."
                );

                return res.sendStatus(
                    200
                );
            }

            const orders =
                readOrders();

            const orderIndex =
                orders.findIndex(
                    order =>
                        order.id ===
                        orderId
                );

            if (
                orderIndex === -1
            ) {
                console.error(
                    "Pedido no encontrado:",
                    orderId
                );

                return res.sendStatus(
                    200
                );
            }

            const order =
                orders[
                    orderIndex
                ];

            // ==============================
            // PAGO APROBADO
            // ==============================

            if (
                payment.status ===
                "approved"
            ) {
                if (
                    order.paymentStatus ===
                    "approved"
                ) {
                    console.log(
                        "Pago ya procesado:",
                        orderId
                    );

                    return res.sendStatus(
                        200
                    );
                }

                order.status =
                    "paid";

                order.paymentId =
                    payment.id;

                order.paymentStatus =
                    payment.status;

                order.paidAt =
                    new Date().toISOString();

                writeOrders(
                    orders
                );

                console.log(
                    "PAGO APROBADO:",
                    orderId
                );

                // ==============================
                // TELEGRAM
                // ==============================

                try {
                    await sendSaleTelegram(
                        order,
                        payment
                    );

                    console.log(
                        "Venta enviada a Telegram:",
                        orderId
                    );

                } catch (
                    telegramError
                ) {
                    console.error(
                        "No se pudo enviar Telegram:",
                        telegramError
                    );
                }

            } else {
                // ==============================
                // OTRO ESTADO
                // ==============================

                order.paymentId =
                    payment.id;

                order.paymentStatus =
                    payment.status;

                writeOrders(
                    orders
                );

                console.log(
                    "Estado de pago:",
                    payment.status
                );
            }

            return res.sendStatus(
                200
            );

        } catch (error) {
            console.error(
                "Error procesando webhook:",
                error
            );

            return res.sendStatus(
                500
            );
        }
    }
);

// ==============================
// HEALTH CHECK
// ==============================

app.get(
    "/api/health",
    (req, res) => {
        res.json({
            ok: true,
            store: "CPP WRLD"
        });
    }
);

// ==============================
// SERVIDOR
// ==============================

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "=============================="
        );

        console.log(
            "       CPP WRLD STORE"
        );

        console.log(
            "=============================="
        );

        console.log(
            `Servidor: http://localhost:${PORT}`
        );

        console.log(
            "Trust proxy: ENABLED"
        );

        console.log(
            "=============================="
        );
    }
);