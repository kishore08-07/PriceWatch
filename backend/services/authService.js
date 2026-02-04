const axios = require('axios');
const User = require('../models/User');

const authenticateWithGoogle = async (token) => {
    try {
        // Use the access token to get user info from Google
        const response = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const payload = response.data;

        let user = await User.findOne({ email: payload.email });
        if (!user) {
            user = new User({
                email: payload.email,
                googleId: payload.sub,
                name: payload.name,
                picture: payload.picture
            });
            await user.save();
        }

        return { success: true, user };
    } catch (error) {
        console.error("SSO Error:", error.response?.data || error.message);
        throw new Error("Invalid Token");
    }
};

module.exports = { authenticateWithGoogle };
