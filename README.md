# migrate2tollfree

Setup Instructions Follow these steps to set up and run the toll-free number automation script:

Prerequisites Node.js: Ensure you have Node.js installed. You can check by running:

node -v

git --version 

2. Clone the Repository

Clone the repository to your local machine:

git clone https://github.com/geverist/migrate2tollfree.git

cd migrate2tollfree

Install Dependencies Once inside the project directory, install the necessary packages:
npm install

Configuration Environment Variables: Rename the .env.example file (if it exists) to .env and update the variables with your values, especially your parent account SID and auth token.

TWILIO_ACCOUNT_SID=your_account_sid TWILIO_AUTH_TOKEN=your_auth_token

CSV Exclusion File: If you're planning to exclude certain accounts, prepare a .csv file with the account SIDs you want to omit.

Running the Script With everything set up, execute the script using:

node migrate2tollfree.js

Follow the on-screen prompts to input the necessary details and execute the script's operations.

Troubleshooting If you encounter any issues:

Check if you've installed all the necessary packages using npm install. Ensure your .env file contains the correct credentials. Consult the Considerations section above to ensure your setup aligns with the script's assumptions.
