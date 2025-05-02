import readline from 'readline';
import OAuthClient from '../models/oauthClient';
import sequelize from '../models/database';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const availableGrants = ['authorization_code', 'password', 'refresh_token', 'client_credentials'];

rl.question('Enter client ID: ', (clientId: string) => {
    rl.question('Enter client secret: ', (clientSecret: string) => {
        sequelize.sync().then(() => {
            OAuthClient.findOne({ where: { clientId } }).then(existingClient => {
                if (existingClient) {
                    existingClient.update({
                        clientSecret,
                        grants: availableGrants,
                        updatedBy: 'system'
                    }).then(client => {
                        console.log('OAuth client updated successfully:', client.toJSON());
                        rl.close();
                    }).catch(error => {
                        console.error('Error updating OAuth client:', error);
                        rl.close();
                    });
                } else {
                    OAuthClient.create({
                        clientId,
                        clientSecret,
                        grants: availableGrants,
                        createdBy: 'system',
                        updatedBy: 'system'
                    }).then(client => {
                        console.log('OAuth client created successfully:', client.toJSON());
                        rl.close();
                    }).catch(error => {
                        console.error('Error creating OAuth client:', error);
                        rl.close();
                    });
                }
            }).catch(error => {
                console.error('Error finding OAuth client:', error);
                rl.close();
            });
        }).catch(error => {
            console.error('Error syncing database:', error);
            rl.close();
        });
    });
});
