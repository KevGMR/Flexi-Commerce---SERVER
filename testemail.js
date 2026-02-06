require('dotenv').config();

const testEmailViaBrevo = async () => {
  const payload = {
    sender: {
      name: "FLEXI-COMMERCE",
      email: process.env.MAILER_ADDRESS,
    },
    to: [{ email: process.env.MAILER_ADDRESS }],
    subject: "FLEXI-COMMERCE Email Test",
    htmlContent: '<h1>Success!</h1><p>Email configuration is working correctly.</p>',
  };

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Email test failed:', response.status, errorData);
      return;
    }

    const data = await response.json();
    console.log('✅ Email sent successfully!');
    console.log('Message ID:', data.messageId);
  } catch (error) {
    console.error('❌ Email test failed:', error.message);
  }
};

testEmailViaBrevo();