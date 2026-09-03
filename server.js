const express = require("express");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 3000;

/* =========================================
   PRODUCTOS
   El precio REAL se controla aquí.
========================================= */

const PRODUCTS = {
    test: {
        id: "test",
        title: "TEST",
        price: 25
    }
};


/* =========================================
   MIDDLEWARE
========================================= */

app.use(express.json());

app.use(
    express.static(__dirname)
);


/* =========================================
   RATE LIMIT
========================================= */

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


/* =========================================
   UTILIDADES
========================================= */

function cleanText(value, maxLength) {

    if (typeof value !== "string") {
        return "";
    }

    return value
        .trim()
        .slice(0, maxLength);
}


function createOrderId() {

    const random =
        crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase();

    return `CPP-${Date.now()}-${random}`;
}


/* =========================================
   CLIENTE
========================================= */

function cleanCustomer(customer) {

    customer = customer || {};

    return {

        firstName:
            cleanText(
                customer.firstName,
                80
            ),

        lastName:
            cleanText(
                customer.lastName,
                80
            ),

        email:
            cleanText(
                customer.email,
                160
            ),

        phone:
            cleanText(
                customer.phone,
                40
            ),

        address:
            cleanText(
                customer.address,
                200
            ),

        city:
            cleanText(
                customer.city,
                100
            ),

        state:
            cleanText(
                customer.state,
                100
            ),

        postalCode:
            cleanText(
                customer.postalCode,
                5
            ),

        notes:
            cleanText(
                customer.notes,
                500
            )

    };
}


/* =========================================
   VALIDAR ITEMS
========================================= */

function validateItems(items) {

    if (
        !Array.isArray(items) ||
        items.length === 0
    ) {
        throw new Error(
            "El carrito está vacío."
        );
    }

    const validatedItems = [];

    for (const item of items) {

        const product =
            PRODUCTS[item.id];

        if (!product) {
            throw new Error(
                "Producto no válido."
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
                "Cantidad no válida."
            );
        }

        validatedItems.push({

            id:
                product.id,

            title:
                product.title,

            quantity:
                quantity,

            unit_price:
                product.price,

            currency_id:
                "MXN"

        });
    }

    return validatedItems;
}


/* =========================================
   PEDIDOS
========================================= */

const ordersFile =
    path.join(
        __dirname,
        "orders.json"
    );


function getOrders() {

    if (
        !fs.existsSync(
            ordersFile
        )
    ) {
        return [];
    }

    try {

        const content =
            fs.readFileSync(
                ordersFile,
                "utf8"
            );

        return JSON.parse(
            content || "[]"
        );

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
        ordersFile,

        JSON.stringify(
            orders,
            null,
            2
        )
    );
}


function saveOrder(order) {

    const orders =
        getOrders();

    orders.push(order);

    saveOrders(orders);
}


function findOrder(orderId) {

    const orders =
        getOrders();

    return orders.find(
        order =>
            order.id === orderId
    );
}


function updateOrder(
    orderId,
    changes
) {

    const orders =
        getOrders();

    const index =
        orders.findIndex(
            order =>
                order.id === orderId
        );

    if (index === -1) {
        return null;
    }

    orders[index] = {
        ...orders[index],
        ...changes
    };

    saveOrders(orders);

    return orders[index];
}


/* =========================================
   MERCADO PAGO
========================================= */

async function createPreference(
    orderId,
    items,
    customer
) {

    const response =
        await fetch(
            "https://api.mercadopago.com/checkout/preferences",
            {

                method: "POST",

                headers: {

                    Authorization:
                        `Bearer ${process.env.MP_ACCESS_TOKEN}`,

                    "Content-Type":
                        "application/json"

                },

                body:
                    JSON.stringify({

                        items: items,

                        payer: {

                            name:
                                customer.firstName,

                            surname:
                                customer.lastName,

                            email:
                                customer.email

                        },

                        external_reference:
                            orderId,

                        notification_url:
                            process.env.MP_NOTIFICATION_URL,

                        back_urls: {

                            success:
                                `${process.env.STORE_URL}/?payment=success`,

                            pending:
                                `${process.env.STORE_URL}/?payment=pending`,

                            failure:
                                `${process.env.STORE_URL}/?payment=failure`

                        },

                        auto_return:
                            "approved"

                    })

            }
        );

    const data =
        await response.json();

    if (!response.ok) {

        console.error(
            "Mercado Pago error:",
            data
        );

        throw new Error(
            "Mercado Pago no pudo crear el checkout."
        );
    }

    return data;
}


/* =========================================
   CREAR PREFERENCIA
========================================= */

app.post(
    "/api/create-preference",

    checkoutLimiter,

    async (req, res) => {

        try {

            if (
                !process.env.MP_ACCESS_TOKEN
            ) {
                throw new Error(
                    "Falta configurar MP_ACCESS_TOKEN."
                );
            }

            if (
                !process.env.MP_NOTIFICATION_URL
            ) {
                throw new Error(
                    "Falta configurar MP_NOTIFICATION_URL."
                );
            }

            if (
                !process.env.STORE_URL
            ) {
                throw new Error(
                    "Falta configurar STORE_URL."
                );
            }


            const customer =
                cleanCustomer(
                    req.body.customer
                );


            if (
                !customer.firstName ||
                !customer.lastName ||
                !customer.email ||
                !customer.phone ||
                !customer.address ||
                !customer.city ||
                !customer.state ||
                !customer.postalCode
            ) {

                return res.status(400).json({

                    error:
                        "Completa todos los datos del cliente."

                });

            }


            const items =
                validateItems(
                    req.body.items
                );


            const total =
                items.reduce(
                    (
                        sum,
                        item
                    ) =>
                        sum +
                        (
                            item.unit_price *
                            item.quantity
                        ),

                    0
                );


            const orderId =
                createOrderId();


            const order = {

                id:
                    orderId,

                status:
                    "pending",

                customer:
                    customer,

                items:
                    items,

                total:
                    total,

                shipping:
                    null,

                paymentId:
                    null,

                createdAt:
                    new Date().toISOString()

            };


            saveOrder(order);


            const preference =
                await createPreference(
                    orderId,
                    items,
                    customer
                );


            return res.json({

                init_point:
                    preference.init_point,

                orderId:
                    orderId

            });

        } catch (error) {

            console.error(
                "Checkout error:",
                error
            );

            return res.status(500).json({

                error:
                    error.message ||
                    "Error creando el checkout."

            });
        }

    }
);


/* =========================================
   FIRMA DEL WEBHOOK
========================================= */

function getWebhookSignature(req) {

    const xSignature =
        req.headers["x-signature"];

    const xRequestId =
        req.headers["x-request-id"];

    if (
        !xSignature ||
        !xRequestId
    ) {
        return null;
    }


    let timestamp = "";
    let signature = "";


    const parts =
        xSignature.split(",");


    for (
        const part of parts
    ) {

        const separator =
            part.indexOf("=");

        if (separator === -1) {
            continue;
        }

        const key =
            part.slice(
                0,
                separator
            );

        const value =
            part.slice(
                separator + 1
            );


        if (
            key === "ts"
        ) {
            timestamp =
                value;
        }


        if (
            key === "v1"
        ) {
            signature =
                value;
        }

    }


    const dataId =
        req.body?.data?.id ||
        req.query["data.id"] ||
        req.query.id ||
        "";


    return {

        timestamp,

        signature,

        requestId:
            xRequestId,

        dataId:
            String(
                dataId
            ).toLowerCase()

    };
}


/* =========================================
   VERIFICAR WEBHOOK
========================================= */

function verifyWebhook(req) {

    const data =
        getWebhookSignature(
            req
        );


    if (!data) {
        return false;
    }


    if (
        !process.env.MP_WEBHOOK_SECRET
    ) {
        console.error(
            "Falta MP_WEBHOOK_SECRET."
        );

        return false;
    }


    if (
        !data.timestamp ||
        !data.signature ||
        !data.dataId
    ) {
        return false;
    }


    const manifest =
        `id:${data.dataId};request-id:${data.requestId};ts:${data.timestamp};`;


    const expected =
        crypto
            .createHmac(
                "sha256",
                process.env.MP_WEBHOOK_SECRET
            )
            .update(manifest)
            .digest("hex");


    try {

        return crypto.timingSafeEqual(

            Buffer.from(
                expected,
                "utf8"
            ),

            Buffer.from(
                data.signature,
                "utf8"
            )

        );

    } catch {

        return false;

    }
}


/* =========================================
   OBTENER PAGO
========================================= */

async function getPayment(
    paymentId
) {

    const response =
        await fetch(
            `https://api.mercadopago.com/v1/payments/${paymentId}`,
            {

                method: "GET",

                headers: {

                    Authorization:
                        `Bearer ${process.env.MP_ACCESS_TOKEN}`

                }

            }
        );


    if (!response.ok) {

        const error =
            await response.text();

        console.error(
            "Payment API error:",
            error
        );

        throw new Error(
            "No se pudo consultar el pago."
        );
    }


    return await response.json();
}


/* =========================================
   EMAIL
========================================= */

async function sendSaleEmail(
    order,
    payment
) {

    if (
        !process.env.SMTP_HOST ||
        !process.env.SMTP_USER ||
        !process.env.SMTP_PASS ||
        !process.env.NOTIFY_EMAIL
    ) {

        console.log(
            "Email no configurado. Venta registrada:",
            order.id
        );

        return;

    }


    const transporter =
        nodemailer.createTransport({

            host:
                process.env.SMTP_HOST,

            port:
                Number(
                    process.env.SMTP_PORT ||
                    587
                ),

            secure:
                process.env.SMTP_SECURE ===
                "true",

            auth: {

                user:
                    process.env.SMTP_USER,

                pass:
                    process.env.SMTP_PASS

            }

        });


    const productLines =
        order.items
            .map(
                item => {

                    const subtotal =
                        item.unit_price *
                        item.quantity;

                    return (
                        `${item.title} x${item.quantity} — ` +
                        `$${subtotal} MXN`
                    );

                }
            )
            .join("\n");


    const message = `

NUEVA VENTA — CPP WRLD
======================

PEDIDO:
${order.id}

ESTADO:
PAGADO

CLIENTE:
${order.customer.firstName} ${order.customer.lastName}

EMAIL:
${order.customer.email}

TELÉFONO:
${order.customer.phone}

DIRECCIÓN:
${order.customer.address}

CIUDAD:
${order.customer.city}

ESTADO:
${order.customer.state}

CÓDIGO POSTAL:
${order.customer.postalCode}

NOTAS:
${order.customer.notes || "Sin notas"}

PRODUCTOS:
${productLines}

TOTAL:
$${order.total} MXN

ID DE PAGO:
${payment.id}

ESTADO MERCADO PAGO:
${payment.status}

FECHA:
${new Date().toLocaleString(
    "es-MX"
)}

======================
CPP WRLD
`;


    await transporter.sendMail({

        from:
            process.env.SMTP_FROM ||
            process.env.SMTP_USER,

        to:
            process.env.NOTIFY_EMAIL,

        subject:
            `Nueva venta CPP WRLD — ${order.id}`,

        text:
            message

    });

}


/* =========================================
   WEBHOOK MERCADO PAGO
========================================= */

app.post(
    "/api/webhook/mercadopago",

    webhookLimiter,

    async (req, res) => {

        try {

            if (
                !verifyWebhook(req)
            ) {

                console.warn(
                    "Webhook rechazado: firma inválida."
                );

                return res
                    .status(401)
                    .send(
                        "Invalid signature"
                    );

            }


            const paymentId =
                req.body?.data?.id ||
                req.query["data.id"] ||
                req.query.id;


            if (!paymentId) {

                return res
                    .status(400)
                    .send(
                        "Missing payment ID"
                    );

            }


            const payment =
                await getPayment(
                    paymentId
                );


            const orderId =
                payment.external_reference;


            if (!orderId) {

                return res
                    .status(200)
                    .send("OK");

            }


            const order =
                findOrder(
                    orderId
                );


            if (!order) {

                console.warn(
                    "Pedido no encontrado:",
                    orderId
                );

                return res
                    .status(200)
                    .send("OK");

            }


            /*
                Solo consideramos vendido
                cuando Mercado Pago dice
                que el pago fue aprobado.
            */

            if (
                payment.status ===
                    "approved" &&
                order.status !==
                    "paid"
            ) {

                const updatedOrder =
                    updateOrder(

                        orderId,

                        {

                            status:
                                "paid",

                            paymentId:
                                String(
                                    payment.id
                                ),

                            paymentStatus:
                                payment.status,

                            paidAt:
                                new Date()
                                    .toISOString()

                        }

                    );


                try {

                    await sendSaleEmail(
                        updatedOrder,
                        payment
                    );

                } catch (emailError) {

                    console.error(
                        "No se pudo enviar el email:",
                        emailError
                    );

                }

            }


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
                .send("Webhook error");

        }

    }
);


/* =========================================
   HEALTH CHECK
========================================= */

app.get(
    "/api/health",
    (req, res) => {

        res.json({

            ok:
                true,

            store:
                "CPP WRLD"

        });

    }
);


/* =========================================
   INICIAR SERVIDOR
========================================= */

app.listen(
    PORT,
    () => {

        console.log("");
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
            "=============================="
        );

    }
);