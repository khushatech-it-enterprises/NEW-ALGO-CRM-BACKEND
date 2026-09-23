const welcomeTemplateOfQSTClients = (name, email, password, loginUrl) => {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="X-UA-Compatible" content="IE=edge" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Welcome to the Platform</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f7; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td align="center" style="padding: 30px;">
            <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
              <tr>
                <td style="background-color: #d93024; color: #ffffff; text-align: center; padding: 30px;">
                  <h1 style="margin: 0;">Welcome to AlgoMatix</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 30px; color: #333333;">
                  <p style="font-size: 16px;">Hi <strong>${name}</strong>,</p>
                  <p style="font-size: 16px;">We're excited to have you on board! Below are your login credentials:</p>
                  
                  <div style="background-color: #f9fafb; border-radius: 6px; padding: 16px; margin: 20px 0;">
                    <p style="font-size: 16px;"><strong>Email:</strong> ${email}</p>
                    <p style="font-size: 16px;"><strong>Password:</strong> ${password}</p>
                  </div>

                  <p style="font-size: 16px;">Please use the button below to log in to your account:</p>
                  
                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${loginUrl}" style="background-color: #d93024; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-size: 16px; font-weight: bold;">
                      Login Now
                    </a>
                  </div>

                  <p style="font-size: 14px;">For security, we recommend changing your password after your first login.</p>
                  <hr style="margin: 30px 0;" />
                  <p style="text-align: center; font-size: 13px; color: #bbbbbb;">&copy; ${new Date().getFullYear()} AlgoMatix. All rights reserved.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};

module.exports = welcomeTemplateOfQSTClients;
