require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { sendTelegramMessage } = require("./telegram");

const app = express();

const PORT = process.env.PORT || 10000;


/* =================================
   RENDER
================================= */

app.set("trust proxy", 1);


/* =================================
   MIDDLEWARE
================================= */

app.use(express.json());

app.use(
    express.urlencoded({
        extended: true
    })
);


/* =================================
   RATE LIMIT
================================= */

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
});

app.use("/api/", apiLimiter);


/* =================================
   STATIC FILES
================================= */

app.use(express.static(__dirname));


/* =================================
   CONFIG
================================= */

const MP_ACCESS_TOKEN =
    process.env.MP_ACCESS_TOKEN;

const MP_WEBHOOK_SECRET =
    process.env.MP_WEBHOOK_SECRET;

const STORE_URL =
    process.env.STORE_URL ||
    `http://localhost:${PORT}`;

const MP_NOTIFICATION_URL =
    process.env.MP_NOTIFICATION_URL ||
    `${STORE_URL}/api/webhook/mercadopago`;


/* =================================
   PRODUCTS
================================= */

const PRODUCTS = {

    test: {
        id: "test",
        title: "TEST",
        price: 25
    }

};


/* =================================
   ORDERS
================================= */

const ORDERS_FILE =
    path.join(__dirname, "orders.json");


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

        return JSON.parse(data);

    } catch (error) {

        console.error(
            "Error leyendo orders.json:",
            error
        );

        return [];

    }

}


function saveOrders(orders) {

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


/* =================================
   ORDER ID
================================= */

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


/* =================================
   HEALTH
================================= */

app.get(
    "/api/health",
    (req, res) => {

        res.json({
            ok: true,
            service: "CPP WRLD STORE"
        });

    }
);


/* =================================
   CREATE PREFERENCE
================================= */

app.post(
    "/api/create-preference",
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
            } = req.body;


            if (
                !Array.isArray(items) ||
                items.length === 0
            ) {

                return res.status(400).json({
                    error:
                        "El carrito está vacío."
                });

            }


            if (!customer) {

                return res.status(400).json({
                    error:
                        "Falta información del cliente."
                });

            }


            const validatedItems = [];


            for (const cartItem of items) {

                const product =
                    PRODUCTS[cartItem.id];


                if (!product) {

                    return res.status(400).json({
                        error:
                            "Producto inválido."
                    });

                }


                const quantity =
                    Number(
                        cartItem.quantity
                    );


                if (
                    !Number.isInteger(quantity) ||
                    quantity < 1 ||
                    quantity > 50
                ) {

                    return res.status(400).json({
                        error:
                            "Cantidad inválida."
                    });

                }


                validatedItems.push({

                    id:
                        product.id,

                    title:
                        product.title,

                    quantity,

                    unit_price:
                        product.price

                });

            }


            const orderId =
                createOrderId();


            const orderItems =
                validatedItems.map(
                    item => ({

                        id:
                            item.id,

                        name:
                            item.title,

                        quantity:
                            item.quantity,

                        price:
                            item.unit_price

                    })
                );


            const total =
                orderItems.reduce(
                    (sum, item) =>
                        sum +
                        (
                            item.price *
                            item.quantity
                        ),
                    0
                );


            /* =========================
               SAVE ORDER
            ========================= */

            const orders =
                readOrders();


            const order = {

                id:
                    orderId,

                status:
                    "pending",

                paymentStatus:
                    "pending",

                customer: {

                    firstName:
                        String(
                            customer.firstName ||
                            ""
                        ).trim(),

                    lastName:
                        String(
                            customer.lastName ||
                            ""
                        ).trim(),

                    email:
                        String(
                            customer.email ||
                            ""
                        ).trim(),

                    phone:
                        String(
                            customer.phone ||
                            ""
                        ).trim(),

                    address:
                        String(
                            customer.address ||
                            ""
                        ).trim(),

                    city:
                        String(
                            customer.city ||
                            ""
                        ).trim(),

                    state:
                        String(
                            customer.state ||
                            ""
                        ).trim(),

                    postalCode:
                        String(
                            customer.postalCode ||
                            ""
                        ).trim(),

                    notes:
                        String(
                            customer.notes ||
                            ""
                        ).trim()

                },

                items:
                    orderItems,

                total,

                paymentId:
                    null,

                preferenceId:
                    null

            };


            orders.push(order);

            saveOrders(orders);


            /* =========================
               MERCADO PAGO
            ========================= */

            const preferenceItems =
                validatedItems.map(
                    item => ({

                        id:
                            item.id,

                        title:
                            item.title,

                        quantity:
                            item.quantity,

                        currency_id:
                            "MXN",

                        unit_price:
                            item.unit_price

                    })
                );


            const preference = {

                items:
                    preferenceItems,

                external_reference:
                    orderId,

                notification_url:
                    MP_NOTIFICATION_URL,

                back_urls: {

                    success:
                        `${STORE_URL}/?payment=success`,

                    failure:
                        `${STORE_URL}/?payment=failure`,

                    pending:
                        `${STORE_URL}/?payment=pending`

                },

                auto_return:
                    "approved"

            };


            const response =
                await fetch(
                    "https://api.mercadopago.com/checkout/preferences",
                    {

                        method: "POST",

                        headers: {

                            "Content-Type":
                                "application/json",

                            "Authorization":
                                `Bearer ${MP_ACCESS_TOKEN}`

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
                    "Mercado Pago error:",
                    data
                );

                return res.status(500).json({
                    error:
                        "No se pudo crear el pago."
                });

            }


            /* =========================
               UPDATE ORDER
            ========================= */

            const updatedOrders =
                readOrders();


            const savedOrder =
                updatedOrders.find(
                    item =>
                        item.id === orderId
                );


            if (savedOrder) {

                savedOrder.preferenceId =
                    data.id;

                saveOrders(
                    updatedOrders
                );

            }


            res.json({

                ok: true,

                orderId,

                preferenceId:
                    data.id,

                init_point:
                    data.init_point

            });


        } catch (error) {

            console.error(
                "Create preference error:",
                error
            );

            res.status(500).json({

                error:
                    "Error interno del servidor."

            });

        }

    }
);


/* =================================
   MERCADO PAGO WEBHOOK
================================= */

app.post(
    "/api/webhook/mercadopago",
    async (req, res) => {

        try {

            /* =========================
               HEADERS
            ========================= */

            const xSignature =
                String(
                    req.headers["x-signature"] ||
                    ""
                ).trim();


            const xRequestId =
                String(
                    req.headers["x-request-id"] ||
                    ""
                ).trim();


            /* =========================
               DATA ID
            ========================= */

            const queryDataId =
                req.query["data.id"];


            const bodyDataId =
                req.body?.data?.id;


            const dataId =
                String(
                    queryDataId ||
                    bodyDataId ||
                    ""
                ).trim();


            console.log(
                "================================"
            );

            console.log(
                "WEBHOOK RECIBIDO"
            );

            console.log(
                "Original URL:",
                req.originalUrl
            );

            console.log(
                "Query:",
                JSON.stringify(
                    req.query
                )
            );

            console.log(
                "Data ID:",
                dataId
            );

            console.log(
                "Request ID:",
                xRequestId
            );

            console.log(
                "Tiene firma:",
                Boolean(xSignature)
            );

            console.log(
                "================================"
            );


            /* =========================
               CONFIG CHECK
            ========================= */

            if (!MP_WEBHOOK_SECRET) {

                console.error(
                    "Falta MP_WEBHOOK_SECRET."
                );

                return res
                    .status(500)
                    .send(
                        "Webhook secret missing"
                    );

            }


            /* =========================
               HEADER CHECK
            ========================= */

            if (!xSignature) {

                console.error(
                    "Webhook sin x-signature."
                );

                return res
                    .status(401)
                    .send(
                        "Missing signature"
                    );

            }


            if (!xRequestId) {

                console.error(
                    "Webhook sin x-request-id."
                );

                return res
                    .status(401)
                    .send(
                        "Missing request id"
                    );

            }


            if (!dataId) {

                console.error(
                    "Webhook sin data.id."
                );

                return res
                    .status(400)
                    .send(
                        "Missing data.id"
                    );

            }


            /* =========================
               PARSE X-SIGNATURE
            ========================= */

            let ts = "";
            let v1 = "";


            const signatureParts =
                xSignature.split(",");


            for (
                const part
                of signatureParts
            ) {

                const separator =
                    part.indexOf("=");


                if (separator === -1) {
                    continue;
                }


                const key =
                    part
                        .slice(
                            0,
                            separator
                        )
                        .trim();


                const value =
                    part
                        .slice(
                            separator + 1
                        )
                        .trim();


                if (key === "ts") {

                    ts = value;

                }


                if (key === "v1") {

                    v1 = value;

                }

            }


            console.log(
                "Timestamp:",
                ts
            );


            console.log(
                "Firma recibida:",
                v1
            );


            if (!ts || !v1) {

                console.error(
                    "Formato de x-signature inválido."
                );

                return res
                    .status(401)
                    .send(
                        "Invalid signature"
                    );

            }


            /* =========================
               MANIFEST
            ========================= */

            const manifest =
                "id:" +
                dataId +
                ";" +
                "request-id:" +
                xRequestId +
                ";" +
                "ts:" +
                ts +
                ";";


            console.log(
                "Manifest generado:",
                manifest
            );


            /* =========================
               HMAC SHA256
            ========================= */

            const generatedSignature =
                crypto
                    .createHmac(
                        "sha256",
                        MP_WEBHOOK_SECRET
                    )
                    .update(
                        manifest,
                        "utf8"
                    )
                    .digest("hex");


            console.log(
                "Firma calculada:",
                generatedSignature
            );


            /* =========================
               CONSTANT TIME COMPARE
            ========================= */

            let signatureValid = false;


            const received =
                String(v1)
                    .toLowerCase();


            const generated =
                String(
                    generatedSignature
                )
                    .toLowerCase();


            if (
                received.length ===
                generated.length
            ) {

                signatureValid =
                    crypto.timingSafeEqual(
                        Buffer.from(
                            received,
                            "utf8"
                        ),
                        Buffer.from(
                            generated,
                            "utf8"
                        )
                    );

            }


            if (!signatureValid) {

                console.error(
                    "Webhook rechazado: firma inválida."
                );

                return res
                    .status(401)
                    .send(
                        "Invalid signature"
                    );

            }


            console.log(
                "================================"
            );

            console.log(
                "FIRMA DEL WEBHOOK VÁLIDA ✅"
            );

            console.log(
                "================================"
            );


            /* =========================
               EVENT DATA
            ========================= */

            const eventType =
                req.body?.type ||
                req.body?.action ||
                "";


            const paymentId =
                dataId;


            console.log(
                "Evento Mercado Pago:",
                {
                    type:
                        eventType,

                    paymentId
                }
            );


            /* =========================
               PAYMENT
            ========================= */

            if (
                eventType === "payment" ||
                req.body?.action ===
                    "payment.updated"
            ) {

                try {

                    const paymentResponse =
                        await fetch(
                            `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
                            {

                                method: "GET",

                                headers: {

                                    "Authorization":
                                        `Bearer ${MP_ACCESS_TOKEN}`

                                }

                            }
                        );


                    const payment =
                        await paymentResponse.json();


                    if (!paymentResponse.ok) {

                        console.error(
                            "Error consultando pago:",
                            payment
                        );

                    } else {

                        console.log(
                            "Pago recibido:",
                            {

                                id:
                                    payment.id,

                                status:
                                    payment.status,

                                external_reference:
                                    payment.external_reference

                            }
                        );


                        const orders =
                            readOrders();


                        const order =
                            orders.find(
                                item =>
                                    item.id ===
                                    payment.external_reference
                            );


                        if (order) {

                            order.paymentId =
                                String(
                                    payment.id
                                );


                            order.paymentStatus =
                                payment.status;


                            if (
                                payment.status ===
                                "approved"
                            ) {

                                order.status =
                                    "paid";

                            } else if (
                                payment.status ===
                                "rejected"
                            ) {

                                order.status =
                                    "rejected";

                            } else if (
                                payment.status ===
                                "cancelled"
                            ) {

                                order.status =
                                    "cancelled";

                            } else {

                                order.status =
                                    "pending";

                            }


                            saveOrders(
                                orders
                            );


                            /* =================
                               TELEGRAM
                            ================= */

                            if (
                                payment.status ===
                                "approved"
                            ) {

                                const customer =
                                    order.customer;


                                const productsMessage =
                                    order.items
                                        .map(
                                            item =>
                                                `• ${item.name} × ${item.quantity} — $${item.price * item.quantity} MXN`
                                        )
                                        .join("\n");


                                const message =

`<b>🛒 NUEVO PEDIDO — CPP WRLD</b>

<b>Pedido:</b> ${order.id}
<b>Estado:</b> PAGADO

<b>👤 CLIENTE</b>
<b>Nombre:</b> ${customer.firstName} ${customer.lastName}
<b>Correo electrónico:</b> ${customer.email}
<b>Teléfono:</b> ${customer.phone}

<b>📍 ENVÍO</b>
<b>Dirección:</b> ${customer.address}
<b>Ciudad:</b> ${customer.city}
<b>Estado:</b> ${customer.state}
<b>Código postal:</b> ${customer.postalCode}

<b>🛍️ PRODUCTOS</b>
${productsMessage}

<b>💰 TOTAL:</b> $${order.total} MXN

<b>💳 Método de pago:</b> Mercado Pago
<b>ID de pago:</b> ${payment.id}`;


                                try {

                                    await sendTelegramMessage(
                                        message
                                    );

                                } catch (
                                    telegramError
                                ) {

                                    console.error(
                                        "Error Telegram:",
                                        telegramError
                                    );

                                }

                            }

                        } else {

                            console.log(
                                "No se encontró una orden para:",
                                payment.external_reference
                            );

                        }

                    }

                } catch (
                    paymentError
                ) {

                    console.error(
                        "Error procesando pago:",
                        paymentError
                    );

                }

            }


            /* =========================
               RESPONSE
            ========================= */

            return res
                .status(200)
                .send("OK");


        } catch (error) {

            console.error(
                "Webhook error:",
                error
            );

            return res
                .status(500)
                .send(
                    "Webhook error"
                );

        }

    }
);


/* =================================
   START SERVER
================================= */

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