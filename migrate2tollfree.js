// Load the configuration values from the .env file
require('dotenv').config();

// Import required libraries
const twilio = require('twilio');
const moment = require('moment');
const readline = require('readline');
const fs = require('fs');

let purchasedCount = 0; // Track how many numbers you've purchased

// Get Twilio account credentials from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

// Create a Twilio client using the provided credentials
const client = twilio(accountSid, authToken);

// This function reads the CSV and returns a set of excluded SIDs
function readExclusionCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const excludedSIDs = new Set();

    // Skip the header (i.e., start from index 1)
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
            excludedSIDs.add(line);
        }
    }
    return excludedSIDs;
}

// Function to get all active subaccounts
const getAllActiveSubaccounts = async () => {
    try {
        const subaccounts = await client.api.accounts.list({status: 'active'});
        return subaccounts;
    } catch (error) {
        console.error("Error fetching subaccounts:", error);
        throw error;
    }
};

// Function to check if a given phone number is toll-free
const isTollFree = (phoneNumber) => {
  const tollFreeRegex = /^(\+?1)?(8(00|33|44|55|66|77|88)[2-9]\d{6})$/gm;
  return tollFreeRegex.test(phoneNumber);
};

// Function to check if a given phone number is a long code (standard 10-digit phone number)
const isLongCode = (phoneNumber) => {
    const longCodeRegex = /^\+1\d{10}$/;
    return longCodeRegex.test(phoneNumber);
};

// Function to check if a given phone number is a short code (5-6 digit phone number)
const isShortCode = (phoneNumber) => {
    const shortCodeRegex = /^(\+?1)?\d{5,6}$/;
    return shortCodeRegex.test(phoneNumber);
};

// Function to filter out long code phone numbers (excluding toll-free and short codes)
const getLongCodeNumbers = (phoneNumbers) => {
    return phoneNumbers.filter(phoneNumber => isLongCode(phoneNumber.phoneNumber) && !isTollFree(phoneNumber.phoneNumber) && !isShortCode(phoneNumber.phoneNumber));
};

// Function to get the count of 30034 and 30035 error messages sent from a phone number in the last 7 days
const getErrorMessagesCountInLast7Days = async (accountSid, phoneNumber) => {
    const sevenDaysAgo = moment().subtract(7, 'days').format('YYYY-MM-DD');
    const usNumberRegex = /^\+1\d{10}$/; // Regular expression for US numbers

    try {
        const messages = await client.api.accounts(accountSid).messages.list({ from: phoneNumber });
        
        const errorMessages = messages.filter(message => 
            [30034, 30035].includes(message.errorCode) && 
            usNumberRegex.test(message.to) &&
            moment(message.dateSent).isAfter(sevenDaysAgo)
        );

        console.log(`Number of 30034 and 30035 errors for ${phoneNumber}:`, errorMessages.length);
        return errorMessages.length;

    } catch (error) {
        console.error('Error fetching messages:', error);
        return 0; // if there's an error, we return 0 for safety. You might want to handle this differently depending on your needs.
    }
};


// Function to get a set of phone numbers that are associated with messaging services
const getPhoneNumbersAssociatedWithServices = async () => {
    const services = await client.messaging.v1.services.list();
    const phoneNumbersAssociatedWithServices = new Set();

    for (const service of services) {
        const phoneNumbers = await client.messaging.v1.services(service.sid).phoneNumbers.list();
        for (const phoneNumber of phoneNumbers) {
            phoneNumbersAssociatedWithServices.add(phoneNumber.phoneNumber);
        }
    }

    return phoneNumbersAssociatedWithServices;
};

// Function to get a list of toll-free numbers that are not currently assigned to any messaging services
const getUnassignedTollFreeNumbers = async (subaccountSid) => {
    const allPhoneNumbers = await client.api.accounts(subaccountSid).incomingPhoneNumbers.list();
    const tollFreeNumbers = allPhoneNumbers.filter(phoneNumber => isTollFree(phoneNumber.phoneNumber));
    const phoneNumbersAssociatedWithServices = await getPhoneNumbersAssociatedWithServices(subaccountSid); // assuming this function can accept subaccountSid

    const unassignedTollFreeNumbers = tollFreeNumbers.filter(phoneNumber => !phoneNumbersAssociatedWithServices.has(phoneNumber.phoneNumber));

    return unassignedTollFreeNumbers;
};

// Function to extract campaign/brand/profile data to align with Toll Free verification
const extractExistingBrandAndCampaignData = async (campaign) => {
let businessName = null;
let websiteURL = null;
let phoneNumber = null;
let firstName = null;
let lastName = null;
let businessTitle = null;
let email = null;

    try {
      // Fetch brand registration
      const brandRegistration = await client.messaging.v1.brandRegistrations(campaign.brandRegistrationSid).fetch();

      // Fetch customer profiles
      const customerProfiles = await client.trusthub.v1.customerProfiles(brandRegistration.customerProfileBundleSid).fetch();
      
      // Fetch end users
      const endUsers = await client.trusthub.v1.endUsers.list();

      for (const endUser of endUsers) {
          if (endUser.type === 'customer_profile_business_information' || endUser.type === 'authorized_representative_1') {
              const fetchedEndUser = await client.trusthub.v1.endUsers(endUser.sid).fetch();
              console.log(fetchedEndUser);
              
              if (fetchedEndUser.type === 'customer_profile_business_information') {
                  businessName = fetchedEndUser.attributes.business_name;
                  websiteURL = fetchedEndUser.attributes.website_url;
              } else if (fetchedEndUser.type === 'authorized_representative_1') {
                  phoneNumber = fetchedEndUser.attributes.phone_number;
                  firstName = fetchedEndUser.attributes.first_name;
                  lastName = fetchedEndUser.attributes.last_name;
                  businessTitle = fetchedEndUser.attributes.business_title;
              }
          }
      }
      email = customerProfiles.email

      // Incorporating the customerProfiles logic
      const customerProfileSid = customerProfiles.sid;
      const customerProfilesEntityAssignments = await client.trusthub.v1.customerProfiles(customerProfileSid).customerProfilesEntityAssignments.list();
      
      // Filter out the assignments whose objectSid starts with "RD"
      const filteredAssignments = customerProfilesEntityAssignments.filter(c => c.objectSid.startsWith('RD'));

      if (filteredAssignments.length === 0) {
        throw new Error('No matching customerProfilesEntityAssignments found.');
      }

      // For the sake of this example, we're only taking the first matching assignment
      const firstAssignmentSid = filteredAssignments[0].objectSid;

      const supporting_document = await client.numbers.v2.regulatoryCompliance.supportingDocuments(firstAssignmentSid).fetch();
      
      // Use the first item in the address_sids array to fetch the address
      const address_sid = supporting_document.attributes.address_sids[0];

      const address = await client.addresses(address_sid).fetch();

        return {
            campaignData: {
                sid: campaign.sid,
                accountSid: campaign.accountSid,
                brandRegistrationSid: campaign.brandRegistrationSid,
                messagingServiceSid: campaign.messagingServiceSid,
                description: campaign.description,
                messageSamples: campaign.messageSamples,
                usAppToPersonUsecase: campaign.usAppToPersonUsecase,
                hasEmbeddedLinks: campaign.hasEmbeddedLinks,
                hasEmbeddedPhone: campaign.hasEmbeddedPhone,
                campaignStatus: campaign.campaignStatus,
                campaignId: campaign.campaignId,
                isExternallyRegistered: campaign.isExternallyRegistered,
                rateLimits: campaign.rateLimits,
                messageFlow: campaign.messageFlow,
                optInMessage: campaign.optInMessage,
                optOutMessage: campaign.optOutMessage,
                helpMessage: campaign.helpMessage,
                optInKeywords: campaign.optInKeywords,
                optOutKeywords: campaign.optOutKeywords,
                helpKeywords: campaign.helpKeywords,
                dateCreated: campaign.dateCreated,
                dateUpdated: campaign.dateUpdated,
                url: campaign.url,
                mock: campaign.mock,
                errors: campaign.errors
            },
            address: {
                street: address.street,
                city: address.city,
                state: address.region,
                zip: address.postalCode,
                country: address.isoCountry
            },
            businessInformation: {
                businessName: businessName,
                websiteURL: websiteURL,
                email: email
            },
            authorizedRepresentative: {
                phoneNumber: phoneNumber,
                firstName: firstName,
                lastName: lastName,
                businessTitle: businessTitle
            }
        };        

    } catch (error) {
        console.error('Error fetching data:', error);
        throw error;  // re-throw the error to be handled by the calling function
    }
};
  
// Handle the verification process for Toll-Free numbers
const handleTollFreeVerification = async (campaign, purchasedNumber, useCaseCategory, optInType, monthlyMessageVolume, optInImageUrls) => {
    try {
        // First, fetch the required data
        const result = await extractExistingBrandAndCampaignData(campaign);
console.log(result)
        console.log('Sending Verification for Toll Free with Existing Campaign/Brand Data');

        await client.messaging.v1.tollfreeVerifications.create({
            businessName: result.businessInformation.businessName,
            productionMessageSample: result.campaignData.messageSamples[0],
            tollfreePhoneNumberSid: purchasedNumber.sid,
            businessWebsite: result.businessInformation.websiteURL,
            businessStreetAddress: result.businessInformation.street,
            businessCity: result.businessInformation.city,
            businessStateProvinceRegion: result.businessInformation.state,
            businessPostalCode: result.businessInformation.zip,
            businessCountry: result.businessInformation.country,
            businessContactFirstName: result.authorizedRepresentative.firstName,
            businessContactLastName: result.authorizedRepresentative.lastName,
            businessContactEmail: result.businessInformation.email,
            businessContactPhone: result.authorizedRepresentative.phoneNumber,
            notificationEmail: result.businessInformation.email,
            useCaseCategories: useCaseCategory,
            useCaseSummary: result.campaignData.description,
            optInImageUrls: [optInImageUrls],
            optInType: optInType,
            messageVolume: monthlyMessageVolume,
        })
        .then(tollfree_verification => console.log(tollfree_verification.sid));
        
    } catch (error) {
        console.error('Error in handleTollFreeVerification:', error);
    }
};

// Function to iterate through all subaccounts associated to the parent account and execute replaceLongCodeWithTollFree
const replaceForAllSubaccounts = async (onlyPending, useCaseCategory, optInType, monthlyMessageVolume, optInImageUrls) => {

    const excludedSIDs = exclusionFilePath ? readExclusionCSV(exclusionFilePath) : new Set();

    try {
        const subaccounts = await getAllActiveSubaccounts();

        for (const subaccount of subaccounts) {
            if (!subaccount.authToken) {
                console.warn(`Skipping subaccount SID: ${subaccount.sid} due to undefined authToken.`);
                continue;
            }
            if (excludedSIDs.has(subaccount.sid)) {
                console.log(`Skipping ${subaccount.sid} as it's in the exclusion list.`);
                continue;
            }
            console.log(`Processing subaccount SID: ${subaccount.sid}`);

            // Create a Twilio client for the subaccount
            const subaccountClient = twilio(subaccount.sid, subaccount.authToken);

            await replaceLongCodeWithTollFree(subaccountClient, onlyPending); 
        }
    } catch (error) {
        console.error("Error processing subaccounts:", error);
    }
};

// Function to replace long code numbers with toll-free numbers in messaging services
const replaceLongCodeWithTollFree = async (client, onlyPending) => {

    try {
      // Get a list of all messaging services and unassigned toll-free numbers
      const messagingServices = await client.messaging.v1.services.list();
      const unassignedTollFreeNumbers = await getUnassignedTollFreeNumbers(client.accountSid);
  
      // Iterate through each messaging service
      for (const service of messagingServices) {
        // Print out the SID of the messaging service
        console.log(`Messaging Service SID: ${service.sid}`);

        // Get a list of phone numbers associated with the messaging service
        const phoneNumbers = await client.messaging.v1.services(service.sid).phoneNumbers.list();
        const longCodeNumbers = getLongCodeNumbers(phoneNumbers);
  
        // Get a list of campaigns associated with the messaging service
        const campaigns = await client.messaging.v1.services(service.sid).usAppToPerson.list();
        let proceed = true;
        let hasCampaign = false;
        let campaign = null;

        // Check if there are any campaigns associated with the messaging service
        if (campaigns.length === 0) {
            if (!onlyPending) {
                hasCampaign = false;
                proceed = false;  
                console.log(`No campaigns associated with messaging service ${service.sid} - skipping number`);
            } else if (onlyPending) {
                console.log(`No campaigns are associated with messaging service ${service.sid} - continuing to evaluate`);
                hasCampaign = false;
                proceed = true;  
            } else {
                hasCampaign = false;
                proceed = false;  
                console.log(`No campaigns are associated with messaging service ${service.sid} - skipping number`);
            }
        } else {
            for (const c of campaigns) {
                if (c.campaignStatus === 'IN_PROGRESS') {
                    campaign = c;
                    hasCampaign = true;
                    proceed = true;
                } else if (c.campaignStatus === 'SUCCESS') {
                    proceed = false;
                    break;
                }

            }
        }

        // If the messaging service has a successful campaign, skip it
        if (!proceed) {
          console.log(`Messaging Service ${service.sid} has either a successful campaign or no campaign. Skipping this service.`);
          continue;
        }
  
        // If there are no long code numbers, skip the messaging service
        if (longCodeNumbers.length === 0) {
          console.log(`No long code numbers associated with the messaging service ${service.sid}`);
          continue;
        }

        // Iterate through each long code number
        for (const longCodeNumber of longCodeNumbers) {
            // If the number is a short code, skip it
            if (isShortCode(longCodeNumber.phoneNumber)) {
              console.log(`Skipping short code number ${longCodeNumber.phoneNumber}.`);
              continue;
            }
        }

        // Process each long code number
        for (const longCodeNumber of longCodeNumbers) {
          // Print out the SID and phone number of the long code number
          console.log(`Phone Number SID: ${longCodeNumber.sid}, Phone Number: ${longCodeNumber.phoneNumber}`);
  
        // Get the count of 30034 and 30035 error messages sent from the long code number in the last 7 days
        const errorMessagesCount = await getErrorMessagesCountInLast7Days(client.accountSid, longCodeNumber.phoneNumber);

        // If no 30034 or 30035 error messages were sent, skip the number
        if (errorMessagesCount <= 0) {
            console.log(`No 30034 or 30035 error messages sent from ${longCodeNumber.phoneNumber} in the last 7 days. Skipping this number.`);
            break;
        }

        // remove long code from messaging service
            await client.messaging.v1.services(service.sid).phoneNumbers(longCodeNumber.sid).remove();
            console.log(`Removed long code number ${longCodeNumber.phoneNumber} from Messaging Service SID: ${service.sid}`);

          // Assign a toll-free number to the messaging service
          let assignedTollFreeNumber = null;
          if (unassignedTollFreeNumbers.length > 0) {
            assignedTollFreeNumber = unassignedTollFreeNumbers.shift(); // Remove the first unassigned toll-free number from the list
            console.log(`Assigned existing toll-free number ${assignedTollFreeNumber.phoneNumber} to Messaging Service SID: ${service.sid}`);
            await client.messaging.v1.services(service.sid).phoneNumbers.create({ phoneNumberSid: assignedTollFreeNumber.sid });
            if (hasCampaign) {
                handleTollFreeVerification(campaign, assignedTollFreeNumber, useCaseCategory, optInType, monthlyMessageVolume, optInImageUrls);
            }
          } else {
            if (purchasedCount < maxTollFreeNumbers) {

                // Purchase and assign a new toll-free number if no unassigned toll-free numbers are available
            const availableTollFreeNumbers = await client.availablePhoneNumbers('US').tollFree.list({ limit: 1 });

            if (availableTollFreeNumbers.length > 0) {
              const purchasedNumber = await client.incomingPhoneNumbers.create({ phoneNumber: availableTollFreeNumbers[0].phoneNumber });
              await client.messaging.v1.services(service.sid).phoneNumbers.create({ phoneNumberSid: purchasedNumber.sid });
              console.log(`Purchased toll-free number ${purchasedNumber.phoneNumber} and added to Messaging Service SID: ${service.sid}`);
              
              assignedTollFreeNumber = purchasedNumber;

              if (hasCampaign) {
                handleTollFreeVerification(campaign, assignedTollFreeNumber, useCaseCategory, optInType, monthlyMessageVolume, optInImageUrls);
              }
            }
            purchasedCount++;
        } else {
            console.log('Reached the maximum number of toll-free numbers allowed for purchase.');
            break; 
          }
        // Remove the long code number from the messaging service
            await client.messaging.v1.services(service.sid).phoneNumbers(longCodeNumber.sid).remove();
            console.log(`Removed long code number ${longCodeNumber.phoneNumber} from Messaging Service SID: ${service.sid}`);
          }
        }
      }
    } catch (error) {
      // Handle errors
      console.error('Failed:', error);
    }
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const { MESSAGE_VOLUMES, OPT_IN_TYPES, USE_CASE_CATEGORIES } = require('./constants');

let maxTollFreeNumbers;
let monthlyMessageVolume;
let exclusionFilePath;
let optInType;
let useCaseCategory;
let onlyPending;

const isValidUrl = (string) => {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
};

// User dialog to capture additional fields needed during the TFN verification step.  These will be the same across all submissions which may be problematic for approvals in some cases.

// Ask the user for the max number of toll-free numbers they want to purchase
rl.question('Do you want to swap numbers on all accounts without a successful campaign (TFN verification on messaging services with failed campaigns or no campaign will NOT be sent, you will need to verify those numbers outside of this script)? (yes/no): ', (pendingAnswer) => {
    const onlyPending = (pendingAnswer.toLowerCase() === 'yes');
    // If user's answer isn't 'yes' or 'no', terminate the script
    if (pendingAnswer.toLowerCase() !== 'yes' && pendingAnswer.toLowerCase() !== 'no') {
        console.error('Invalid choice. Please enter "yes" or "no".');
        rl.close();
        return;
    }

    // Next prompt: Ask for max toll-free numbers
    rl.question('What is the maximum number of toll-free numbers you are willing to purchase? (Enter "unlimited" for no limit): ', (answer) => {
        if (answer.toLowerCase() === 'unlimited') {
            maxTollFreeNumbers = Infinity;
        } else {
            maxTollFreeNumbers = parseInt(answer, 10);
        }

        // Next prompt: Ask about exclusion CSV
        rl.question('Would you like to include an exclusion .csv for account SID\'s? (Enter path to CSV or "no" for none): ', (csvAnswer) => {
            if (csvAnswer.toLowerCase() !== 'no') {
                if (fs.existsSync(csvAnswer)) {
                    exclusionFilePath = csvAnswer;
                } else {
                    console.error('The provided file path does not exist. Please check and run the program again.');
                    rl.close();
                    return;
                }
            }

            // Next prompt: Monthly message volume
            rl.question('Enter your Monthly Expected Message Volume for Toll Free Verification (' + MESSAGE_VOLUMES.join(', ') + '): ', (volumeAnswer) => {
                if (MESSAGE_VOLUMES.includes(volumeAnswer)) {
                    monthlyMessageVolume = volumeAnswer;

                    // Next prompt: Opt-in type
                    rl.question('Select your OptInType (' + OPT_IN_TYPES.join(', ') + '): ', (optInAnswer) => {
                        if (OPT_IN_TYPES.includes(optInAnswer)) {
                            optInType = optInAnswer;

                            // Next prompt: Use case category
                            rl.question('Select your UseCaseCategory (' + USE_CASE_CATEGORIES.join(', ') + '): ', (useCaseAnswer) => {
                                if (USE_CASE_CATEGORIES.includes(useCaseAnswer)) {
                                    useCaseCategory = useCaseAnswer;

                                    // Last prompt: Opt-in image URLs
                                    rl.question('Please enter your OptInImageUrls (must be a valid URL): ', (urlAnswer) => {
                                        if (isValidUrl(urlAnswer)) {
                                            optInImageUrls = urlAnswer;
                                            rl.close();
                                            replaceForAllSubaccounts(onlyPending, useCaseCategory, optInType, monthlyMessageVolume, optInImageUrls);
                                        } else {
                                            console.error('Invalid URL provided for OptInImageUrls. Please check and provide a valid URL.');
                                            rl.close();
                                            return;
                                        }
                                    });
                                } else {
                                    console.error('Invalid UseCaseCategory choice. Please enter one of the provided options.');
                                    rl.close();
                                    return;
                                }
                            });
                        } else {
                            console.error('Invalid OptInType choice. Please enter one of the provided options.');
                            rl.close();
                            return;
                        }
                    });
                } else {
                    console.error('Invalid volume choice. Please enter one of the provided options.');
                    rl.close();
                    return;
                }
            });
        });
    });
});
