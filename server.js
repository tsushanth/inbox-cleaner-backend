// server.js - Optimized for Google Cloud Run
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const stripe = require('stripe')('pk_live_51Rj2XTKFBTQTkmzt7Ugkb3Igf0PvJTFTMGxgfTIIN3L6qwGeDXHXmqhbRYVkyE9T5Tk1ZmEyBoiY4UsUB6r8m3vo00tMbusb7Z');
const nodemailer = require('nodemailer');

const app = express();

// =======================
// MIDDLEWARE SETUP
// =======================

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// Compression for better performance
app.use(compression());

// CORS configuration
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://your-extension-domain.com'] 
        : ['http://localhost:3000', 'chrome-extension://*'],
    credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 100 : 1000,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Stripe webhook rate limit (more restrictive)
const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    skipSuccessfulRequests: true,
});

// =======================
// EMAIL CONFIGURATION
// =======================

let emailTransporter;

try {
    emailTransporter = nodemailer.createTransporter({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD
        }
    });
    
    // Verify email configuration
    emailTransporter.verify((error, success) => {
        if (error) {
            console.warn('Email configuration warning:', error.message);
        } else {
            console.log('✅ Email service ready');
        }
    });
} catch (error) {
    console.warn('Email service initialization failed:', error.message);
}

// =======================
// DATA STORAGE (In production, use Cloud Firestore or Cloud SQL)
// =======================

const userBillingData = new Map();

// =======================
// VALIDATION MIDDLEWARE
// =======================

const validatePayment = [
    body('amount').isFloat({ min: 0.5 }).withMessage('Minimum payment amount is $0.50'),
    body('currency').isIn(['usd', 'eur', 'gbp']).withMessage('Invalid currency'),
    body('userId').isLength({ min: 1 }).withMessage('User ID is required'),
];

const validateEmail = [
    body('to').isEmail().withMessage('Valid email address is required'),
    body('subject').isLength({ min: 1, max: 200 }).withMessage('Subject is required'),
];

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array()
        });
    }
    next();
};

// =======================
// PAYMENT ENDPOINTS
// =======================

// Create payment intent
app.post('/api/create-payment-intent', validatePayment, handleValidationErrors, async (req, res) => {
    try {
        const { amount, currency, userId } = req.body;

        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to cents
            currency: currency || 'usd',
            metadata: {
                userId: userId,
                service: 'inbox-cleaner-pro'
            },
            automatic_payment_methods: {
                enabled: true,
            },
        });

        res.json({
            success: true,
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id
        });

    } catch (error) {
        console.error('Payment intent creation failed:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to create payment intent' 
        });
    }
});

// Process payment
app.post('/api/process-payment', validatePayment, handleValidationErrors, async (req, res) => {
    try {
        const { amount, currency, userId, paymentMethodId } = req.body;

        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: currency || 'usd',
            payment_method: paymentMethodId,
            confirm: true,
            return_url: `${req.protocol}://${req.get('host')}/payment-return`,
            metadata: {
                userId: userId,
                service: 'inbox-cleaner-pro'
            }
        });

        if (paymentIntent.status === 'succeeded') {
            // Store payment record
            const paymentRecord = {
                userId,
                amount,
                currency,
                transactionId: paymentIntent.id,
                timestamp: new Date().toISOString(),
                status: 'completed'
            };

            // Update user billing data
            const userData = userBillingData.get(userId) || { payments: [] };
            userData.payments.push(paymentRecord);
            userData.tier = 'paid';
            userData.lastPayment = paymentRecord;
            userBillingData.set(userId, userData);

            res.json({
                success: true,
                transactionId: paymentIntent.id,
                amount: amount
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Payment requires additional action',
                paymentIntent: {
                    id: paymentIntent.id,
                    status: paymentIntent.status,
                    client_secret: paymentIntent.client_secret
                }
            });
        }

    } catch (error) {
        console.error('Payment processing failed:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Payment processing failed'
        });
    }
});

// Stripe webhook endpoint
app.post('/api/stripe-webhook', webhookLimiter, express.raw({type: 'application/json'}), (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body, 
            sig, 
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;
            console.log('✅ Payment succeeded:', paymentIntent.id);
            
            // Update user status in your database
            const userId = paymentIntent.metadata.userId;
            if (userId) {
                const userData = userBillingData.get(userId) || {};
                userData.tier = 'paid';
                userData.lastSuccessfulPayment = new Date().toISOString();
                userBillingData.set(userId, userData);
            }
            break;
            
        case 'payment_intent.payment_failed':
            const failedPayment = event.data.object;
            console.log('❌ Payment failed:', failedPayment.id);
            
            // Handle failed payment - maybe send notification email
            break;
            
        default:
            console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({received: true});
});

// =======================
// EMAIL NOTIFICATION ENDPOINTS
// =======================

// Send usage summary email
app.post('/api/send-usage-summary', validateEmail, handleValidationErrors, async (req, res) => {
    if (!emailTransporter) {
        return res.status(503).json({ 
            success: false,
            error: 'Email service not available' 
        });
    }

    try {
        const { to, subject, html } = req.body;

        const mailOptions = {
            from: `"Inbox Cleaner Pro" <${process.env.GMAIL_USER}>`,
            to: to,
            subject: subject,
            html: html,
            replyTo: process.env.SUPPORT_EMAIL || process.env.GMAIL_USER
        };

        const info = await emailTransporter.sendMail(mailOptions);
        
        console.log('📧 Usage summary email sent:', info.messageId);
        res.json({ 
            success: true, 
            messageId: info.messageId 
        });

    } catch (error) {
        console.error('Failed to send usage summary email:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to send email' 
        });
    }
});

// Send billing notification
app.post('/api/send-billing-notification', validateEmail, handleValidationErrors, async (req, res) => {
    if (!emailTransporter) {
        return res.status(503).json({ 
            success: false,
            error: 'Email service not available' 
        });
    }

    try {
        const { to, type, data } = req.body;

        let subject, html;

        switch (type) {
            case 'payment_successful':
                subject = '✅ Payment Confirmation - Inbox Cleaner Pro';
                html = generatePaymentConfirmationEmail(data);
                break;
            case 'free_tier_warning':
                subject = '⚠️ Approaching Free Tier Limit - Inbox Cleaner Pro';
                html = generateFreeTierWarningEmail(data);
                break;
            case 'payment_failed':
                subject = '❌ Payment Failed - Inbox Cleaner Pro';
                html = generatePaymentFailedEmail(data);
                break;
            default:
                return res.status(400).json({ 
                    success: false,
                    error: 'Invalid notification type' 
                });
        }

        const mailOptions = {
            from: `"Inbox Cleaner Pro" <${process.env.GMAIL_USER}>`,
            to: to,
            subject: subject,
            html: html,
            replyTo: process.env.SUPPORT_EMAIL || process.env.GMAIL_USER
        };

        const info = await emailTransporter.sendMail(mailOptions);
        
        res.json({ 
            success: true, 
            messageId: info.messageId 
        });

    } catch (error) {
        console.error('Failed to send billing notification:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to send notification' 
        });
    }
});

// =======================
// USER DATA ENDPOINTS
// =======================

// Get user billing data
app.get('/api/user/:userId/billing', (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!userId || userId.length < 5) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user ID'
            });
        }

        const userData = userBillingData.get(userId) || {
            tier: 'free',
            payments: [],
            totalUsage: 0
        };
        
        res.json({
            success: true,
            data: userData
        });
    } catch (error) {
        console.error('Failed to get user billing data:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to retrieve billing data' 
        });
    }
});

// Update user billing data
app.post('/api/user/:userId/billing', (req, res) => {
    try {
        const { userId } = req.params;
        const billingData = req.body;
        
        if (!userId || userId.length < 5) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user ID'
            });
        }
        
        userBillingData.set(userId, billingData);
        
        res.json({
            success: true,
            message: 'Billing data updated'
        });
    } catch (error) {
        console.error('Failed to update user billing data:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to update billing data' 
        });
    }
});

// =======================
// ANALYTICS ENDPOINTS
// =======================

// Track usage analytics
app.post('/api/analytics/usage', (req, res) => {
    try {
        const { userId, emailsClassified, actions, timestamp } = req.body;
        
        // In production, store this in your analytics database (BigQuery, etc.)
        console.log('📊 Usage tracked:', {
            userId,
            emailsClassified,
            actions,
            timestamp: timestamp || new Date().toISOString()
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Failed to track usage:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to track usage' 
        });
    }
});

// =======================
// EMAIL TEMPLATE GENERATORS
// =======================

function generatePaymentConfirmationEmail(data) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Confirmation</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; background: #f8fafc; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px 20px; text-align: center; }
            .content { padding: 30px; }
            .amount { font-size: 28px; font-weight: bold; color: #10b981; margin: 20px 0; }
            .details { background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .footer { padding: 20px; background: #f8fafc; color: #6b7280; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>✅ Payment Confirmed</h1>
                <p>Thank you for using Inbox Cleaner Pro!</p>
            </div>
            
            <div class="content">
                <h2>Payment Successfully Processed</h2>
                <p>Your payment has been confirmed and your account has been updated.</p>
                
                <div class="details">
                    <p><strong>Transaction ID:</strong> ${data.transactionId}</p>
                    <p><strong>Amount:</strong> <span class="amount">$${data.amount.toFixed(2)}</span></p>
                    <p><strong>Date:</strong> ${new Date(data.timestamp).toLocaleDateString()}</p>
                    <p><strong>Payment Method:</strong> ${data.paymentMethod || 'Card'}</p>
                </div>
                
                <p>You can now continue using Inbox Cleaner Pro without any interruptions. We appreciate your business!</p>
            </div>
            
            <div class="footer">
                <p>If you have any questions about this payment, please contact our support team.</p>
                <p>© 2024 Inbox Cleaner Pro. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    `;
}

function generateFreeTierWarningEmail(data) {
    const usagePercent = (data.emailsUsed / data.freeLimit * 100).toFixed(1);
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Free Tier Warning</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; background: #f8fafc; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px 20px; text-align: center; }
            .content { padding: 30px; }
            .progress-container { background: #e5e7eb; height: 24px; border-radius: 12px; overflow: hidden; margin: 20px 0; }
            .progress-bar { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); height: 100%; transition: width 0.3s ease; border-radius: 12px; }
            .usage-stats { background: #fffbeb; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>⚠️ Approaching Free Tier Limit</h1>
                <p>You're almost at your monthly limit</p>
            </div>
            
            <div class="content">
                <h2>Usage Alert</h2>
                <p>You've used <strong>${data.emailsUsed}</strong> out of <strong>${data.freeLimit}</strong> free email classifications this month.</p>
                
                <div class="progress-container">
                    <div class="progress-bar" style="width: ${usagePercent}%;"></div>
                </div>
                <p style="text-align: center; color: #6b7280; font-size: 14px;">${usagePercent}% used</p>
                
                <div class="usage-stats">
                    <h3>What happens next?</h3>
                    <p>• After ${data.freeLimit} emails, you'll be charged <strong>$${data.costPerEmail}</strong> per additional email classified</p>
                    <p>• Your billing cycle resets on ${new Date(data.nextBillingDate).toLocaleDateString()}</p>
                    <p>• You can upgrade to unlimited usage anytime</p>
                </div>
                
                <p>Consider upgrading to our paid plan for unlimited email classifications and priority support.</p>
            </div>
        </div>
    </body>
    </html>
    `;
}

function generatePaymentFailedEmail(data) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Failed</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; background: #f8fafc; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 30px 20px; text-align: center; }
            .content { padding: 30px; }
            .error-details { background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ef4444; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>❌ Payment Failed</h1>
                <p>We couldn't process your payment</p>
            </div>
            
            <div class="content">
                <h2>Payment Issue</h2>
                <p>Unfortunately, your payment of <strong>$${data.amount.toFixed(2)}</strong> could not be processed.</p>
                
                <div class="error-details">
                    <h3>Details:</h3>
                    <p><strong>Reason:</strong> ${data.reason || 'Payment method declined'}</p>
                    <p><strong>Transaction ID:</strong> ${data.transactionId || 'N/A'}</p>
                    <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
                </div>
                
                <h3>What to do next:</h3>
                <ul>
                    <li>Check that your payment method has sufficient funds</li>
                    <li>Verify your billing information is correct</li>
                    <li>Try a different payment method</li>
                    <li>Contact your bank if the issue persists</li>
                </ul>
                
                <p>Your service access may be limited until payment is completed. Please try again or contact our support team for assistance.</p>
            </div>
        </div>
    </body>
    </html>
    `;
}

// =======================
// HEALTH CHECK & STATUS
// =======================

app.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        services: {
            stripe: !!process.env.STRIPE_SECRET_KEY,
            email: !!emailTransporter,
            database: true // Update based on your database connection
        }
    };
    
    res.json(health);
});

app.get('/', (req, res) => {
    res.json({
        name: 'Inbox Cleaner Pro API',
        version: '1.0.0',
        status: 'running',
        documentation: '/api/docs'
    });
});

// =======================
// ERROR HANDLING
// =======================

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    
    res.status(error.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : error.message
    });
});

// =======================
// SERVER STARTUP
// =======================

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Inbox Cleaner Pro API running on port ${PORT}`);
    console.log(`📧 Email service: ${emailTransporter ? '✅ Ready' : '❌ Not configured'}`);
    console.log(`💳 Stripe: ${process.env.STRIPE_SECRET_KEY ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});

module.exports = app;