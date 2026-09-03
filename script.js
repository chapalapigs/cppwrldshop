/* =================================
   CPP WRLD
   STORE
================================= */


/* =================================
   PRODUCTS
================================= */

const products = [

    {
        id: "test",

        name: "TEST",

        price: 25,

        image: "assets/test.jpg",

        tag: "DROP 01"
    }

];


/* =================================
   CART
================================= */

let cart = JSON.parse(
    localStorage.getItem("cpp_wrld_cart") || "[]"
);


/* =================================
   PRICE
================================= */

function formatPrice(price) {

    return `$${price.toLocaleString("es-MX")} MXN`;

}


/* =================================
   SAVE CART
================================= */

function saveCart() {

    localStorage.setItem(
        "cpp_wrld_cart",
        JSON.stringify(cart)
    );

}


/* =================================
   PRODUCTS
================================= */

function renderProducts() {

    const grid =
        document.getElementById("productGrid");


    grid.innerHTML = "";


    products.forEach(product => {

        const card =
            document.createElement("article");


        card.className =
            "product-card";


        card.innerHTML = `

            <div class="product-image">

                ${
                    product.image
                    ?
                    `
                    <img
                        src="${product.image}"
                        alt="${product.name}"
                        onerror="
                            this.style.display='none';
                            this.nextElementSibling.style.display='flex';
                        "
                    >
                    `
                    :
                    ""
                }


                <div
                    class="product-placeholder"
                    style="
                        display:
                        ${product.image ? "none" : "flex"};
                    "
                >
                    CPP
                </div>


                <div class="product-tag">
                    ${product.tag}
                </div>

            </div>


            <div class="product-info">

                <div class="product-name">
                    ${product.name}
                </div>

                <div class="product-price">
                    ${formatPrice(product.price)}
                </div>


                <button
                    class="add-button"
                    onclick="
                        addToCart('${product.id}')
                    "
                >
                    ADD TO BAG
                </button>

            </div>

        `;


        grid.appendChild(card);

    });

}


/* =================================
   ADD TO CART
================================= */

function addToCart(productId) {

    const product =
        products.find(
            product =>
                product.id === productId
        );


    if (!product) return;


    const existing =
        cart.find(
            item =>
                item.id === productId
        );


    if (existing) {

        existing.quantity++;

    } else {

        cart.push({

            id: productId,

            quantity: 1

        });

    }


    saveCart();

    renderCart();

    openCart();

    showToast(
        "Added to bag"
    );

}


/* =================================
   CHANGE QUANTITY
================================= */

function changeQuantity(
    productId,
    amount
) {

    const item =
        cart.find(
            item =>
                item.id === productId
        );


    if (!item) return;


    item.quantity += amount;


    if (item.quantity <= 0) {

        cart =
            cart.filter(
                item =>
                    item.id !== productId
            );

    }


    saveCart();

    renderCart();

}


/* =================================
   REMOVE
================================= */

function removeFromCart(productId) {

    cart =
        cart.filter(
            item =>
                item.id !== productId
        );


    saveCart();

    renderCart();

}


/* =================================
   RENDER CART
================================= */

function renderCart() {

    const container =
        document.getElementById("cartItems");


    const count =
        cart.reduce(
            (total, item) =>
                total + item.quantity,
            0
        );


    document.getElementById("cartCount")
        .textContent = count;


    if (cart.length === 0) {

        container.innerHTML = `

            <div class="empty-cart">

                Your bag is empty.

            </div>

        `;


        updateTotals(0);

        return;

    }


    let subtotal = 0;


    container.innerHTML = "";


    cart.forEach(item => {

        const product =
            products.find(
                product =>
                    product.id === item.id
            );


        if (!product) return;


        const itemTotal =
            product.price *
            item.quantity;


        subtotal += itemTotal;


        const element =
            document.createElement("div");


        element.className =
            "cart-item";


        element.innerHTML = `

            <div class="cart-item-image">

                ${
                    product.image
                    ?
                    `
                    <img
                        src="${product.image}"
                        alt="${product.name}"
                        onerror="
                            this.style.display='none';
                            this.nextElementSibling.style.display='block';
                        "
                    >
                    `
                    :
                    ""
                }


                <span
                    style="
                        display:
                        ${product.image ? "none" : "block"};
                    "
                >
                    CPP
                </span>

            </div>


            <div>

                <div class="cart-item-name">
                    ${product.name}
                </div>


                <div class="cart-item-price">
                    ${formatPrice(product.price)}
                </div>


                <div class="quantity">

                    <button
                        onclick="
                            changeQuantity(
                                '${product.id}',
                                -1
                            )
                        "
                    >
                        −
                    </button>


                    <span>
                        ${item.quantity}
                    </span>


                    <button
                        onclick="
                            changeQuantity(
                                '${product.id}',
                                1
                            )
                        "
                    >
                        +
                    </button>


                    <button
                        class="remove"
                        onclick="
                            removeFromCart(
                                '${product.id}'
                            )
                        "
                    >
                        REMOVE
                    </button>

                </div>

            </div>

        `;


        container.appendChild(element);

    });


    updateTotals(subtotal);

}


/* =================================
   TOTALS
================================= */

function updateTotals(subtotal) {

    document.getElementById("cartSubtotal")
        .textContent =
        formatPrice(subtotal);


    document.getElementById("cartTotal")
        .textContent =
        formatPrice(subtotal);

}


/* =================================
   OPEN CART
================================= */

function openCart() {

    document
        .getElementById("cart")
        .classList.add("open");


    document
        .getElementById("overlay")
        .classList.add("active");

}


/* =================================
   CLOSE CART
================================= */

function closeCart() {

    document
        .getElementById("cart")
        .classList.remove("open");


    document
        .getElementById("overlay")
        .classList.remove("active");

}


/* =================================
   TOAST
================================= */

function showToast(message) {

    const toast =
        document.getElementById("toast");


    toast.textContent =
        message;


    toast.classList.add("show");


    setTimeout(() => {

        toast.classList.remove("show");

    }, 2000);

}


/* =================================
   CHECKOUT
================================= */

document
    .getElementById("checkoutForm")
    .addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();


            if (cart.length === 0) {

                showToast(
                    "Your bag is empty"
                );

                return;

            }


            const button =
                document.getElementById(
                    "checkoutButton"
                );


            button.disabled = true;

            button.textContent =
                "CREATING PAYMENT...";


            const customer = {

                firstName:
                    document
                    .getElementById(
                        "firstName"
                    )
                    .value
                    .trim(),


                lastName:
                    document
                    .getElementById(
                        "lastName"
                    )
                    .value
                    .trim(),


                email:
                    document
                    .getElementById(
                        "email"
                    )
                    .value
                    .trim(),


                phone:
                    document
                    .getElementById(
                        "phone"
                    )
                    .value
                    .trim(),


                address:
                    document
                    .getElementById(
                        "address"
                    )
                    .value
                    .trim(),


                city:
                    document
                    .getElementById(
                        "city"
                    )
                    .value
                    .trim(),


                state:
                    document
                    .getElementById(
                        "state"
                    )
                    .value,


                postalCode:
                    document
                    .getElementById(
                        "postalCode"
                    )
                    .value
                    .trim(),


                notes:
                    document
                    .getElementById(
                        "notes"
                    )
                    .value
                    .trim()

            };


            try {

                const response =
                    await fetch(
                        "/api/create-preference",
                        {

                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({

                                    items:
                                        cart.map(
                                            item => ({

                                                id:
                                                    item.id,

                                                quantity:
                                                    item.quantity

                                            })
                                        ),

                                    customer

                                })

                        }
                    );


                const data =
                    await response.json();


                if (!response.ok) {

                    throw new Error(
                        data.error ||
                        "Payment error"
                    );

                }


                if (!data.init_point) {

                    throw new Error(
                        "Mercado Pago link missing"
                    );

                }


                window.location.href =
                    data.init_point;


            } catch (error) {

                console.error(error);


                showToast(
                    error.message ||
                    "Something went wrong"
                );


                button.disabled = false;

                button.textContent =
                    "CONTINUAR CON MERCADO PAGO";

            }

        }
    );


/* =================================
   START
================================= */

renderProducts();

renderCart();