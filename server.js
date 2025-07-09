// server.js - Using native Node.js HTTP (no Express dependency)
const http = require('http');
const url = require('url');
const querystring = require('querystring');

// In-memory storage
const userBillingData = new Map();

// Helper function to parse JSON body
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

// Helper function to send JSON response
function sendJSON(res, data, statusCode = 200) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.end(JSON.stringify(data));
}

// Main request handler
async function requestHandler(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    const method = req.method;

    console.log(`${method} ${path}`);

    // Handle CORS preflight
    if (method === 'OPTIONS') {
        sendJSON(res, { success: true }, 200);
        return;
    }

    try {
        // Route: Health check
        if (path === '/health' && method === 'GET') {
            sendJSON(res, {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: Math.floor(process.uptime())
            });
            return;
        }

        // Route: Root
        if (path === '/' && method === 'GET') {
            sendJSON(res, {
                name: 'Inbox Cleaner Pro API',
                version: '1.0.0',
                status: 'running'
            });
            return;
        }

        // Route: Process payment
        if (path === '/api/process-payment' && method === 'POST') {
            const body = await parseBody(req);
            const { amount, currency = 'usd', userId } = body;

            if (!amount || amount < 0.5 || !userId) {
                sendJSON(res, {
                    success: false,
                    error: 'Invalid payment data'
                }, 400);
                return;
            }

            // Simulate successful payment
            const paymentRecord = {
                userId,
                amount,
                currency,
                transactionId: 'sim_' + Date.now(),
                timestamp: new Date().toISOString(),
                status: 'completed'
            };

            // Update user billing data
            const userData = userBillingData.get(userId) || { payments: [] };
            userData.payments = userData.payments || [];
            userData.payments.push(paymentRecord);
            userData.tier = 'paid';
            userBillingData.set(userId, userData);

            sendJSON(res, {
                success: true,
                transactionId: paymentRecord.transactionId,
                amount: amount
            });
            return;
        }

        // Route: Send usage summary
        if (path === '/api/send-usage-summary' && method === 'POST') {
            const body = await parseBody(req);
            const { to, subject, html } = body;

            if (!to || !subject || !html) {
                sendJSON(res, {
                    success: false,
                    error: 'Missing required email fields'
                }, 400);
                return;
            }

            // For now, just log the email
            console.log('📧 Email would be sent to:', to);
            console.log('📧 Subject:', subject);

            sendJSON(res, {
                success: true,
                messageId: 'sim_' + Date.now()
            });
            return;
        }

        // Route: Get user billing data
        if (path === '/api/user-billing' && method === 'GET') {
            const userId = parsedUrl.query.userId;

            if (!userId || userId.length < 3) {
                sendJSON(res, {
                    success: false,
                    error: 'Invalid user ID'
                }, 400);
                return;
            }

            const userData = userBillingData.get(userId) || {
                tier: 'free',
                payments: [],
                totalUsage: 0
            };

            sendJSON(res, {
                success: true,
                data: userData
            });
            return;
        }

        // Route: Update user billing data
        if (path === '/api/user-billing' && method === 'POST') {
            const body = await parseBody(req);
            const { userId, ...billingData } = body;

            if (!userId || userId.length < 3) {
                sendJSON(res, {
                    success: false,
                    error: 'Invalid user ID'
                }, 400);
                return;
            }

            userBillingData.set(userId, billingData);

            sendJSON(res, {
                success: true,
                message: 'Billing data updated'
            });
            return;
        }

        // Route: Track usage analytics
        if (path === '/api/analytics-usage' && method === 'POST') {
            const body = await parseBody(req);
            const { userId, emailsClassified, actions, timestamp } = body;

            console.log('📊 Usage tracked:', {
                userId,
                emailsClassified,
                actions,
                timestamp: timestamp || new Date().toISOString()
            });

            sendJSON(res, { success: true });
            return;
        }

        // Route: Send billing notification
        if (path === '/api/send-billing-notification' && method === 'POST') {
            const body = await parseBody(req);
            const { to, type, data } = body;

            if (!to || !type) {
                sendJSON(res, {
                    success: false,
                    error: 'Missing required fields'
                }, 400);
                return;
            }

            console.log('📧 Billing notification would be sent:', { to, type });

            sendJSON(res, {
                success: true,
                messageId: 'sim_' + Date.now()
            });
            return;
        }

        // Route: Create payment intent (for Stripe integration later)
        if (path === '/api/create-payment-intent' && method === 'POST') {
            const body = await parseBody(req);
            const { amount, currency = 'usd', userId } = body;

            if (!amount || amount < 0.5 || !userId) {
                sendJSON(res, {
                    success: false,
                    error: 'Invalid payment data'
                }, 400);
                return;
            }

            // Simulate payment intent creation
            sendJSON(res, {
                success: true,
                clientSecret: 'pi_sim_' + Date.now() + '_secret',
                paymentIntentId: 'pi_sim_' + Date.now()
            });
            return;
        }

        // 404 - Route not found
        sendJSON(res, {
            success: false,
            error: 'Endpoint not found',
            path: path,
            method: method
        }, 404);

    } catch (error) {
        console.error('Request handling error:', error);
        sendJSON(res, {
            success: false,
            error: 'Internal server error'
        }, 500);
    }
}

// Create and start the server
const PORT = process.env.PORT || 8080;

const server = http.createServer(requestHandler);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`💡 Using native Node.js HTTP server (no Express)`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

module.exports = server;