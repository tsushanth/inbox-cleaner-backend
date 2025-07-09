// server.js - Step 1: Adding email functionality
const http = require('http');
const url = require('url');
const querystring = require('querystring');

// Initialize email service if credentials are available
let emailTransporter = null;


    try {
        const nodemailer = require('nodemailer');
        emailTransporter = nodemailer.createTransporter({
            service: 'gmail',
            auth: {
                user: "inboxcleanersoftware@gmail.com",
                pass: "KashtePhale!9"
            }
        });
        
        // Verify email configuration
        emailTransporter.verify()
            .then(() => {
                console.log('✅ Email service ready');
            })
            .catch((error) => {
                console.warn('⚠️ Email verification failed:', error.message);
                emailTransporter = null;
            });
    } catch (error) {
        console.warn('⚠️ Nodemailer not available:', error.message);
        emailTransporter = null;
    }


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

// Email template generators
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

function generateUsageSummaryHTML(periodData) {
    const startDate = new Date(periodData.startDate).toLocaleDateString();
    const endDate = new Date(periodData.endDate).toLocaleDateString();
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .header { background: #4285f4; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .stat-box { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 8px; }
            .cost { font-size: 24px; font-weight: bold; color: #34a853; }
            .action-stats { display: flex; justify-content: space-around; margin: 20px 0; }
            .action-stat { text-align: center; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>📧 Inbox Cleaner Usage Summary</h1>
            <p>Billing Period: ${startDate} - ${endDate}</p>
        </div>
        
        <div class="content">
            <div class="stat-box">
                <h2>📊 Usage Statistics</h2>
                <p><strong>Total Emails Classified:</strong> ${periodData.emailsClassified}</p>
                <p><strong>API Calls Made:</strong> ${periodData.apiCalls}</p>
                <p><strong>Free Tier Used:</strong> ${Math.min(periodData.emailsClassified, 100)} / 100</p>
            </div>
            
            <div class="stat-box">
                <h2>💰 Cost Breakdown</h2>
                <div class="cost">Total Cost: $${periodData.totalCost.toFixed(2)}</div>
                <p>Cost per email: $0.01</p>
                <p>Billable emails: ${Math.max(0, periodData.emailsClassified - 100)}</p>
            </div>
            
            <div class="stat-box">
                <h2>🎯 Actions Performed</h2>
                <div class="action-stats">
                    <div class="action-stat">
                        <strong>📥 Archived</strong><br>
                        ${periodData.actions.archive || 0}
                    </div>
                    <div class="action-stat">
                        <strong>🗑️ Deleted</strong><br>
                        ${periodData.actions.delete || 0}
                    </div>
                    <div class="action-stat">
                        <strong>⭐ Marked Important</strong><br>
                        ${periodData.actions.mark_important || 0}
                    </div>
                </div>
            </div>
            
            <div class="stat-box">
                <h2>📈 Performance Insights</h2>
                <p><strong>Time Saved:</strong> ~${Math.round(periodData.emailsClassified * 0.5)} minutes</p>
                <p><strong>Average Cost per Action:</strong> $${periodData.emailsClassified > 0 ? (periodData.totalCost / periodData.emailsClassified).toFixed(4) : '0.00'}</p>
            </div>
        </div>
    </body>
    </html>
    `;
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
                uptime: Math.floor(process.uptime()),
                services: {
                    email: !!emailTransporter
                }
            });
            return;
        }

        // Route: Root
        if (path === '/' && method === 'GET') {
            sendJSON(res, {
                name: 'Inbox Cleaner Pro API',
                version: '1.0.0',
                status: 'running',
                features: ['billing', 'email-notifications']
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
                status: 'completed',
                paymentMethod: 'Card'
            };

            // Update user billing data
            const userData = userBillingData.get(userId) || { payments: [] };
            userData.payments = userData.payments || [];
            userData.payments.push(paymentRecord);
            userData.tier = 'paid';
            userData.lastPayment = paymentRecord;
            userBillingData.set(userId, userData);

            // Send payment confirmation email if email service is available
            if (emailTransporter && userData.userEmail) {
                try {
                    const emailHtml = generatePaymentConfirmationEmail(paymentRecord);
                    await emailTransporter.sendMail({
                        from: `"Inbox Cleaner Pro" <${process.env.GMAIL_USER}>`,
                        to: userData.userEmail,
                        subject: '✅ Payment Confirmation - Inbox Cleaner Pro',
                        html: emailHtml
                    });
                    console.log('📧 Payment confirmation email sent to:', userData.userEmail);
                } catch (emailError) {
                    console.warn('⚠️ Failed to send payment confirmation email:', emailError.message);
                }
            }

            sendJSON(res, {
                success: true,
                transactionId: paymentRecord.transactionId,
                amount: amount
            });
            return;
        }

        // Route: Send usage summary (ENHANCED)
        if (path === '/api/send-usage-summary' && method === 'POST') {
            if (!emailTransporter) {
                sendJSON(res, {
                    success: false,
                    error: 'Email service not configured'
                }, 503);
                return;
            }

            const body = await parseBody(req);
            const { to, subject, html, periodData } = body;

            if (!to || !subject) {
                sendJSON(res, {
                    success: false,
                    error: 'Missing required email fields'
                }, 400);
                return;
            }

            try {
                // Use provided HTML or generate from periodData
                const emailHtml = html || (periodData ? generateUsageSummaryHTML(periodData) : '<p>Usage summary</p>');

                const mailOptions = {
                    from: `"Inbox Cleaner Pro" <${process.env.GMAIL_USER}>`,
                    to: to,
                    subject: subject,
                    html: emailHtml,
                    replyTo: process.env.SUPPORT_EMAIL || process.env.GMAIL_USER
                };

                const info = await emailTransporter.sendMail(mailOptions);
                console.log('📧 Usage summary email sent:', info.messageId);

                sendJSON(res, {
                    success: true,
                    messageId: info.messageId
                });
            } catch (error) {
                console.error('Failed to send email:', error);
                sendJSON(res, {
                    success: false,
                    error: 'Failed to send email: ' + error.message
                }, 500);
            }
            return;
        }

        // Route: Send billing notification (NEW)
        if (path === '/api/send-billing-notification' && method === 'POST') {
            if (!emailTransporter) {
                sendJSON(res, {
                    success: false,
                    error: 'Email service not configured'
                }, 503);
                return;
            }

            const body = await parseBody(req);
            const { to, type, data } = body;

            if (!to || !type) {
                sendJSON(res, {
                    success: false,
                    error: 'Missing required fields'
                }, 400);
                return;
            }

            try {
                let subject, html;

                switch (type) {
                    case 'payment_successful':
                        subject = '✅ Payment Confirmation - Inbox Cleaner Pro';
                        html = generatePaymentConfirmationEmail(data);
                        break;
                    case 'free_tier_warning':
                        subject = '⚠️ Approaching Free Tier Limit - Inbox Cleaner Pro';
                        html = `<p>You're approaching your free tier limit. You've used ${data.emailsUsed} out of ${data.freeLimit} free emails.</p>`;
                        break;
                    case 'payment_failed':
                        subject = '❌ Payment Failed - Inbox Cleaner Pro';
                        html = `<p>Your payment of $${data.amount} failed. Please try again.</p>`;
                        break;
                    default:
                        sendJSON(res, {
                            success: false,
                            error: 'Invalid notification type'
                        }, 400);
                        return;
                }

                const mailOptions = {
                    from: `"Inbox Cleaner Pro" <${process.env.GMAIL_USER}>`,
                    to: to,
                    subject: subject,
                    html: html
                };

                const info = await emailTransporter.sendMail(mailOptions);

                sendJSON(res, {
                    success: true,
                    messageId: info.messageId
                });
            } catch (error) {
                console.error('Failed to send notification:', error);
                sendJSON(res, {
                    success: false,
                    error: 'Failed to send notification'
                }, 500);
            }
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
                totalUsage: 0,
                currentPeriod: {
                    emailsClassified: 0,
                    totalCost: 0,
                    startDate: new Date().toISOString(),
                    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                }
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

        // Route: Create payment intent (for future Stripe integration)
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
    console.log(`📧 Email service: ${emailTransporter ? '✅' : '❌'}`);
    console.log(`💡 Using native Node.js HTTP server`);
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