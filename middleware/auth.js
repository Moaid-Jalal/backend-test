const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  try {
    const token = req.cookies.token;


    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    if(decoded.exp < Date.now() / 1000) {
      return res.status(401).json({ message: 'Token expired' });
    }

    // if(!decoded.role || decoded.role !== 'admin') {
    //   return res.status(403).json({ message: 'Access denied' });
    // }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

module.exports = auth;