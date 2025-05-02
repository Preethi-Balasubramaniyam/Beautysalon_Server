import readline from 'readline';
import User from '../models/user';
import { UserRole, UserScope } from '../types/userTypes';
import sequelize from '../models/database';
import bcrypt from 'bcryptjs';
import Org from '../models/org';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string): Promise<string> => {
    return new Promise((resolve) => {
        rl.question(query, resolve);
    });
};

const createOrg = async (orgName: string): Promise<Org> => {
    let org = await Org.findOne({ where: { name: orgName } });
    if (!org) {
        org = await Org.create({
            name: orgName,
            configuration: {
                zoho: {
                    clientId: "yourClientId",
                    clientSecret: "yourClientSecret",
                    redirectUri: "yourRedirectUri",
                    refreshToken: "yourRefreshToken",
                    orgId: "yourOrgId",
                    apiUrl: "yourApiUrl",
                    tokenUrl: "yourTokenUrl"
                },
                whatsapp: {
                    chatEndpoints: [],
                    phoneconfig: []
                }
            },
            createdBy: "system",
            updatedBy: "system"
        });
    }
    return org;
};

const createAdminUser = async (
    username: string,
    password: string,
    name: string,
    email: string,
    mobile: string,
    org: Org
): Promise<User> => {
    const hashedPassword = bcrypt.hashSync(password, 10);
    
    return User.create({
        username,
        name,
        mobile,
        email,
        scope: [UserScope.Admin, UserScope.Manager, UserScope.ReadOnlyUser, UserScope.ServiceProvider],
        createdBy: 'system',
        updatedBy: 'system',
        password: hashedPassword,
        role: UserRole.Admin,
        orgId: org.id
    });
};

const main = async () => {
    try {
        await sequelize.sync();

        const username = await question('Enter username: ');
        const password = await question('Enter password: ');
        const name = await question('Enter name: ');
        const email = await question('Enter email: ');
        const orgName = await question('Enter orgName: ');
        const mobile = await question('Enter mobile number: ');

        const org = await createOrg(orgName);
        const user = await createAdminUser(username, password, name, email, mobile, org);

        console.log('User created successfully:', user.toJSON());
    } catch (error) {
        console.error('Error:', error);
    } finally {
        rl.close();
    }
};

main();