const express = require('express')
const cors = require('cors')
const bcrypt = require('bcrypt');
var jwt = require('jsonwebtoken');
require('dotenv').config()
const app = express()
const port = process.env.PORT || 3000

app.use(express.json())
app.use(cors())







const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DBUSER}:${process.env.password}@cluster0.hwuf8vx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});



async function run() {
    try {

        const database = client.db('MoneyBankDB')
        const usersCollection = database.collection("users");
        const transactionsCollection = database.collection("transfer");


        // crud operation api start

        
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Access denied" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(400).json({ message: "Invalid token" });
  }
};

const authorize = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
};


        app.post("/api/v1/register", async (req, res) => {
            const { name, pin, mobile, email,role } = req.body;
      
            const existingUser = await usersCollection.findOne({ email,mobile });
            if (existingUser) {
              return res.status(400).json({ success: false, message: "User already exists" });
            }
      
            const hashedPin = await bcrypt.hash(pin,10);
            const user = {
              name,
              pin: hashedPin,
              mobile,
              email,
              balance: 0,
              status: "pending",
              role: role,
            };
      
            await usersCollection.insertOne(user);
            res.status(201).json({ success: true, message: "User registered successfully" });
          });
      
        //   User Login
          app.post("/api/v1/login", async (req, res) => {
            const { email,mobile, pin } = req.body;
      
            const user = await usersCollection.findOne({
              $or: [{ email: email }, { mobile: mobile }],
            });
      
            if (!user) {
              return res.status(401).json({ message: "Invalid email or mobile number" });
            }
      
            const isPinValid = await bcrypt.compare(pin, user.pin);
            if (!isPinValid) {
              return res.status(401).json({ message: "Invalid PIN" });
            }
            if (user.status === "pending") {
              return res.json({ success: false, message: "Account is pending approval", status: "pending" });
          }
            if (user.status === "block") {
              return res.json({ success: false, message: "Account is blockted", status: "block" });
          }
      
            const token = jwt.sign(
                { id: user._id, role: user.role,name:user.name,mobile:user.mobile },
                process.env.JWT_SECRET,
                { expiresIn:'100d' }
              );
              
           return res.json({ success: true, token,status:user.status!=='pending',role:user.role });
          });
      
          // Admin Approval
          app.put("/api/v1/admin/approve-user/:id",authenticate,authorize(['admin']), async (req, res) => {
            const { id } = req.params;
          
            try {
              const user = await usersCollection.findOne({ _id: new ObjectId(id), status: "pending" });
          
              // Check if the user exists and their status is pending
              if (!user) {
                return res.status(400).json({
                  success: false,
                  message: "User not found or already approved.",
                });
              }
              let newBalance = 0;
              if (user.role === 'user') {
                newBalance = 40;
              } else if (user.role === 'agent') {
                newBalance = 1000;
              } else {
                return res.status(400).json({
                  success: false,
                  message: "Invalid user role.",
                });
              }
          
              // Update the user's status and balance
              const result = await usersCollection.updateOne(
                { _id: new ObjectId(id), status: "pending" },
                {
                  $set: { status: "active", balance: newBalance },
                }
              );
          
              if (result.modifiedCount === 0) {
                return res.status(400).json({
                  success: false,
                  message: "User not found or already approved.",
                });
              }
          
              res.status(200).json({
                success: true,
                message: "User approved successfully!",
              });
            } catch (error) {
              console.error("Error approving user:", error);
              res.status(500).json({
                success: false,
                message: "Internal server error.",
              });
            }
          });


        //   Send User by User

        app.post('/api/v1/send-money',authenticate, async (req, res) => {
            const { recipientMobile, amount, pin, senderNumber } = req.body;
          
            try {
              if (amount < 50) {
                return res.status(400).json({ message: "Minimum transaction amount is 50 Taka" });
              }
          
              // Find sender by senderNumber (assuming it's a unique identifier)
              const sender = await usersCollection.findOne({ mobile: senderNumber });
              if (!sender) {
                return res.status(404).json({ message: "Sender not found" });
              }
          
              // Verify PIN
              const isPinValid = await bcrypt.compare(pin, sender.pin);
              if (!isPinValid) {
                return res.status(401).json({ message: "Invalid PIN" });
              }
          
              // Find recipient by recipientMobile
              const recipient = await usersCollection.findOne({ mobile: recipientMobile });
              if (!recipient) {
                return res.status(404).json({ message: "Recipient not found" });
              }
          
              // Calculate fee if applicable
              let fee = 0;
              if (amount > 100) {
                fee = 5;
              }
          
              // Check sender's balance
              if (sender.balance < amount + fee) {
                return res.status(400).json({ message: "Insufficient balance" });
              }
          
              // Update sender's balance (deduct amount + fee)
              await usersCollection.updateOne(
                { _id: new ObjectId(sender._id) },
                { $inc: { balance: -(amount + fee) } }
              );
          
              // Update recipient's balance (add amount)
              await usersCollection.updateOne(
                { _id: new ObjectId(recipient._id) },
                { $inc: { balance: amount } }
              );
          
              // Record transaction
              await transactionsCollection.insertOne({
                senderId: sender._id,
                recipientId: recipient._id,
                amount,
                fee,
                type: "send-money",
                timestamp: new Date(),
              });
          
              res.json({ message: "Money sent successfully" });
            } catch (error) {
              console.error("Error sending money:", error);
              res.status(500).json({ message: "An error occurred while processing the transaction" });
            }
          });



        //   cash-out

        app.post('/api/v1/cash-out',authenticate, async (req, res) => {
            const { agentMobile, amount, pin, userMobile } = req.body;
          
            try {
              // Find user by mobile number
              const user = await usersCollection.findOne({ mobile: userMobile });
              if (!user) {
                return res.status(404).json({ message: "User not found" });
              }
          
              // Verify PIN
              const isPinValid = await bcrypt.compare(pin, user.pin);
              if (!isPinValid) {
                return res.status(401).json({ message: "Invalid PIN" });
              }
          
              // Find agent by mobile number and role 'agent'
              const agent = await usersCollection.findOne({ mobile: agentMobile, role: 'agent' });
              if (!agent) {
                return res.status(404).json({ message: "Agent not found" });
              }
          
              // Calculate fee
              const fee = (amount * 1.5) / 100;
              if (user.balance < amount + fee) {
                return res.status(400).json({ message: "Insufficient balance" });
              }
          
              // Update user's balance (deduct amount + fee)
              await usersCollection.updateOne(
                { _id: new ObjectId(user._id) }, // Corrected: Use new ObjectId()
                { $inc: { balance: -(amount + fee) } }
              );
          
              // Update agent's balance (add amount + fee)
              await usersCollection.updateOne(
                { _id: new ObjectId(agent._id) }, // Corrected: Use new ObjectId()
                { $inc: { balance: amount + fee } }
              );
          
              // Record transaction
              await transactionsCollection.insertOne({
                userId: user._id,
                agentId: agent._id,
                amount,
                fee,
                type: "cash-out",
                timestamp: new Date(),
              });
          
              res.json({status:true, message: "Cash out successful" });
            } catch (error) {
              console.error("Error cashing out:", error);
              res.status(500).json({ message: "An error occurred while processing the cash out" });
            }
          });


          // cash-in

          app.post("/api/v1/cash-in", authenticate, async (req, res) => {
            const { agentNumber, amount, userNumber } = req.body;
          
            try {
              const user = await usersCollection.findOne({ mobile: userNumber, role: "user" });
              if (!user) {
                return res.status(404).json({ message: "User not found" });
              }
          
              const agent = await usersCollection.findOne({ mobile: agentNumber });
              if (!agent) {
                return res.status(404).json({ message: "Agent not found" });
              }
          
              await usersCollection.updateOne(
                { _id: new ObjectId(user._id) }, // Correct usage: new ObjectId(user._id)
                { $inc: { balance: amount } }
              );
              await usersCollection.updateOne(
                { _id: new ObjectId(agent._id) }, // Correct usage: new ObjectId(agent._id)
                { $inc: { balance: -amount } }
              );
          
              await transactionsCollection.insertOne({
                userId: new ObjectId(user._id), // Correct usage: new ObjectId(user._id)
                agentId: new ObjectId(agent._id), // Correct usage: new ObjectId(agent._id)
                amount,
                type: "cash-in",
                timestamp: new Date(),
              });
          
              res.json({ message: "Cash in successful" });
            } catch (error) {
              console.error("Error in cash-in endpoint:", error);
              res.status(500).json({ message: "Internal server error" });
            }
          });

           
        app.get('/api/v1/transactions/admin/type' ,authenticate, async (req, res) => {
          const { type } = req.query;
          const page = parseInt(req.query.page) || 1; // Default to page 1
          const limit = parseInt(req.query.limit) || 10; // Default to 10 transactions per page
          const skip = (page - 1) * limit;
      
          try {
              const transactions = await transactionsCollection
                  .find({ type })
                  .sort({ timestamp: -1 }) // Sort by latest first
                  .skip(skip)
                  .limit(limit)
                  .toArray();
      
              const total = await transactionsCollection.countDocuments({ type }); // Get total count of transactions of this type
              const totalPages = Math.ceil(total / limit);
      
              res.status(200).json({ transactions, totalPages, currentPage: page });
          } catch (error) {
              console.error('Error fetching transactions by type:', error);
              res.status(500).json({ message: 'An error occurred while fetching transactions by type' });
          }
      });

          app.get("/api/v1/balance/:id",authenticate, async (req, res) => {
            const userId = req.params.id; // Accessing the value of :id from the URL
          
            try {
              // Query MongoDB to find the user based on userId
              const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
          
              if (!user) {
                return res.status(404).json({ message: "User not found" });
              }
          
              // Respond with the user data
              res.json({balance:user.balance});
            } catch (error) {
              console.error("Error fetching user:", error);
              res.status(500).json({ message: "Internal server error" });
            }
          });

          app.get('/api/v1/transactions/type',authenticate, async (req, res) => {
            const { type } = req.query;
        
            try {
                const transactions = await transactionsCollection
                    .find({ type })
                    .sort({ timestamp: -1 }) // Sort by latest first
                    .toArray();
        
                res.status(200).json(transactions);
            } catch (error) {
                console.error('Error fetching transactions by type:', error);
                res.status(500).json({ message: 'An error occurred while fetching transactions by type' });
            }
        });
        



        // admin
        
        app.get("/api/v1/admin/users/search",authenticate,authorize(['admin']), async (req, res) => {
          const { name } = req.query;
        
          try {
            if (name) {
              // Perform search if name query parameter is provided
              const users = await usersCollection.find({ name: { $regex: name, $options: "i" } }).toArray();
              return res.json(users);
            } else {
              // If name parameter is not provided, return all users
              const allUsers = await usersCollection.find({}).toArray();
              return res.json(allUsers);
            }
          } catch (error) {
            res.status(500).json({ message: "Failed to search users" });
          }
        });
        
      // blocked

      app.put("/api/v1/admin/users/block/:id",authenticate,authorize(['admin']), async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;
      
        try {
          let updateFields = { status };
      
          if (status === 'blocked') {
            updateFields = { status, balance: 0 }; // Optionally update balance to zero when blocking
          }
      
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: updateFields,
            }
          );
      
          if (result.modifiedCount === 0) {
            return res.status(404).json({
              success: false,
              message: "User not found.",
            });
          }
      
          res.status(200).json({
            success: true,
            message: `User ${status === 'active' ? 'approved' : 'blocked'} successfully!`,
          });
        } catch (error) {
          console.error("Error updating user status:", error);
          res.status(500).json({
            success: false,
            message: "Internal server error.",
          });
        }
      });
      


      

        
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send('Server Running!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})