const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if(decoded.exp < Date.now() / 1000) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if(!decoded.role || decoded.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Unauthorized' });
  }
};

const checkIfAdmin = (req) => {
  try {
    const token = req.cookies.token;
    if (!token) return false;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || decoded.exp < Date.now() / 1000) return false;

    return true
  } catch (err) {
    return false;
  }
};


module.exports = { auth, checkIfAdmin };