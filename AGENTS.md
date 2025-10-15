<Context> Hi. I am working on a cyber-security related project. The project is to set up an exchange server and a DC server that is connected to that exchange. The project is focusing on creating a management web UI for message deletion from every inbox in every account from the exchange server. So it will work like that: Assume there are 4 workers in my company, all of them received an email that is phishing from a person called "Malicious@gmail.com". In order to get rid of that email from within the exchange, I will have to go through each and every inbox of my 4 workers and delete the phishing message from their inbox. My goal is to create a Management UI where a manager can write an email address that he wants every mail from that specific email address(like "Malicious@gmail.com") to be deleted from any inbox in my company. So to be clear - the management UI will have an option for inputing an email address, when the manager click "Delete" so the script will run, the script will go through every single inbox in the organization and delete every single mail that is related to that inputed mail address. I have already configured Exchange, DC and configured the Third VM (which is domain joined already). 

 The version of my Exchange is as follows: 
 ```
 [PS] C:\Windows\system32>(Get-Command ExSetup.exe).FileVersionInfo ProductVersion FileVersion FileName -------------- ----------- -------- 15.02.2562.017 15.02.2562.017 C:\Program Files\Microsoft\Exchange Server\V15\bin\ExSetup.exe [PS] C:\Windows\system32>Get-ExchangeServer | fl Name,Edition,AdminDisplayVersion Name : EXCH01 Edition : StandardEvaluation AdminDisplayVersion : Version 15.2 (Build 2562.17) [PS] C:\Windows\system32># Expect: 15.2.2562.17 [PS] C:\Windows\system32> 
```
The Exchange UI will sit on a third VM. (And in production it will be on a server that can connect to the Exchange)
</Context> 


<UI_Look>
I want the UI to have the following sections:

## Search Section
1. Query searches where it is possible to query the exchange and receive all users who received a message from "X", it will have the option to filter by various filters too.

## Delete Section
2. Section for email deletion where there are various filters and also the option to delete all emails that were sent by a specific email address. 

## LOGS Section
3. Sections that shows logs regarding the execution of Email Deletion. 

</UI_Look>

<Task>
Everything works perfect, now for 2 enhancement:

1. Everytime we run ```Hard Delete``` or ```Soft Delete``` (When simulation is off), then I want the user to see a pop up, in the pop up the user will be prompt to write ```DELETE``` in order to accept the deletion.

2. Inside of the ```Deletion Section```, I want an additional button called "Cancel" to be present (It will be present only while there is an execution - could be a ```Simulation```, ```Soft Delete``` or even ```Hard Delete``` ). The button will cancel the execution when clicked. 

</Task>