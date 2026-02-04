const transporter = require('../config/email');

const sendEmailAlert = (email, product) => {
    return new Promise((resolve, reject) => {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: `Price Drop Alert: ${product.productName}!`,
            html: `
          <h2>Good news! Your product is now cheaper.</h2>
          <p><b>${product.productName}</b> has dropped to <b>${product.currency || '₹'}${product.currentPrice}</b>.</p>
          <p>Target Price was: ${product.currency || '₹'}${product.targetPrice}</p>
          <a href="${product.url}" style="padding: 10px 20px; background: #6366f1; color: white; border-radius: 5px; text-decoration: none;">Buy Now</a>
          <br/><br/>
          <img src="${product.image}" width="200" />
        `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("Email Error:", error);
                reject(error);
            } else {
                console.log("Email sent:", info.response);
                resolve(info);
            }
        });
    });
};

module.exports = { sendEmailAlert };
